// PLAN-006 — players sign in with Google, book online only while signed in, and
// see their game log. Google is a small fake: the authorization code IS the ID
// token's claims (base64url JSON), so each test picks exactly what Google says.

import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

const FORMAT = "YYYY-MM-DD HH:mm:ss";
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const ALL_DAY = EVERY_DAY.map((dayOfWeek) => ({ dayOfWeek, opensAt: "00:00", closesAt: "24:00" }));
const CLIENT_ID = "test-client.apps.googleusercontent.com";
const APP = "http://app.test";

/** A fake Google token endpoint: code "refuse" → 400; else the code is the claims. */
const fakeGoogleToken = () =>
  new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const code = new URLSearchParams(Buffer.concat(chunks).toString()).get("code");
        if (code === "refuse") {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "invalid_grant" }));
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ access_token: "x", id_token: `h.${code}.sig` }));
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });

describe("player sign-in with Google (PLAN-006)", () => {
  let ctx;
  let google;
  let admin;
  let moment;
  const home = {};

  const call = (method, url, body, who = admin) => ctx.api(method, url, { token: who.token, body });
  const at = (hoursFromNow) =>
    moment().tz("Asia/Manila").startOf("hour").add(hoursFromNow, "hours").format(FORMAT);
  const slot = (hoursFromNow) => {
    const s = at(hoursFromNow);
    return { date: s.slice(0, 10), startTime: s.slice(11, 16) };
  };

  /** Follow a redirect by hand → the Location as a URL. */
  const go = async (path) => {
    const res = await ctx.get(path, { redirect: "manual" });
    assert.equal(res.status, 303, `${path} → ${res.status}`);
    return new URL(res.headers.get("location"));
  };

  /** Start a sign-in → { state, nonce } from the Google URL it sends the browser to. */
  const start = async (returnPath = "/me/games") => {
    const google = await go(`/api/v1/auth/google/start?return=${encodeURIComponent(returnPath)}`);
    return {
      url: google,
      state: google.searchParams.get("state"),
      nonce: google.searchParams.get("nonce"),
    };
  };

  /** Google's answer for `claims` (merged over a good default for the started sign-in). */
  const callback = ({ state, nonce }, claims = {}) => {
    const body = {
      iss: "https://accounts.google.com",
      aud: CLIENT_ID,
      exp: Math.floor(Date.now() / 1000) + 3600,
      nonce,
      sub: "google-sub-ana",
      email: "ana@example.test",
      email_verified: true,
      name: "Ana Reyes",
      given_name: "Ana",
      family_name: "Reyes",
      picture: "https://lh3.googleusercontent.com/ana",
      ...claims,
    };
    const code = Buffer.from(JSON.stringify(body)).toString("base64url");
    return go(`/api/v1/auth/google/callback?code=${code}&state=${encodeURIComponent(state)}`);
  };

  /** Save a player's first-sign-in profile (PATCH /player/me). */
  const completeProfile = async (session, body = {}) => {
    const res = await ctx.api("PATCH", "/player/me", {
      player: session.token,
      body: { firstName: "Test", lastName: "Player", phone: "0917 000 0000", ...body },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.data.player;
  };

  /** A full sign-in → the session tokens. */
  const signIn = async (claims = {}) => {
    const back = await callback(await start(), claims);
    const res = await ctx.api("POST", "/player/session", {
      body: { code: back.searchParams.get("code") },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return { token: res.data.accessToken.token, refreshToken: res.data.refreshToken.token };
  };

  before(async () => {
    google = await fakeGoogleToken();
    ctx = await startTestApp({
      env: {
        GOOGLE_CLIENT_ID: CLIENT_ID,
        GOOGLE_CLIENT_SECRET: "test-secret",
        GOOGLE_LOGIN_REDIRECT_URI: "http://127.0.0.1/api/v1/auth/google/callback",
        GOOGLE_AUTH_URL: "https://accounts.example.test/o/oauth2/v2/auth",
        GOOGLE_TOKEN_URL: `http://127.0.0.1:${google.address().port}/token`,
        APP_URL: APP,
        RATE_LIMIT_PUBLIC_BOOK_POINTS: "1000",
        RATE_LIMIT_PUBLIC_CHECKIN_POINTS: "1000",
      },
    });
    admin = await ctx.createStaff("Admin", { access: "write" });
    ({ moment } = await ctx.importFromBack("server/src/utils/dateUtils.js"));

    const venueId = (await call("POST", "/admin/venues", { name: "Sign-in Courts" })).data.venueId;
    const court = await call("POST", "/admin/courts", {
      venueId,
      name: "Court 1",
      cameraRtspUrl: "rtsp://u:p@10.0.6.1:554/stream1",
    });
    assert.equal(court.status, 201, JSON.stringify(court.body));
    // Checking in needs the venue's recorder box online
    const box = (await ctx.pairBox(admin.token, venueId, "Box Sign-in")).data.token;
    const beat = await ctx.api("POST", "/device/heartbeat", {
      body: { cameras: [] },
      headers: { Authorization: `Device ${box}` },
    });
    assert.equal(beat.status, 200, JSON.stringify(beat.body));
    const saved = await call("PUT", `/admin/booking-settings/${venueId}`, {
      maxBookingMinutes: 180,
      bookingDaysAhead: 14,
      deskHoldMinutes: 30,
      onlineHoldMinutes: 15,
      cancelCutoffHours: 24,
      checkInEarlyMinutes: 10,
      hours: ALL_DAY,
      rates: [{ name: "All day", daysOfWeek: EVERY_DAY, startTime: "00:00", endTime: "24:00", pricePerHour: 300 }],
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const link = await call("POST", `/admin/booking-settings/${venueId}/link`);
    home.venueId = venueId;
    home.courtId = court.data.courtId;
    home.token = link.data.bookingUrl.split("/book/")[1];
    home.courtKey = (await ctx.api("GET", `/public/book/${home.token}`)).data.courts[0].key;
  });
  after(async () => {
    await ctx?.stop();
    google?.close();
  });

  describe("signing in", () => {
    it("sends the browser to Google with the right client, scopes and a nonce", async () => {
      const { url, state, nonce } = await start(`/book/${home.token}?date=2026-12-01`);
      assert.equal(url.origin + url.pathname, "https://accounts.example.test/o/oauth2/v2/auth");
      assert.equal(url.searchParams.get("client_id"), CLIENT_ID);
      assert.equal(url.searchParams.get("scope"), "openid email profile");
      assert.equal(url.searchParams.get("response_type"), "code");
      assert.ok(nonce && state);
      const { readLoginState } = await ctx.importFromBack("server/src/utils/googleSignIn.js");
      assert.deepEqual(readLoginState(state), {
        returnPath: `/book/${home.token}?date=2026-12-01`,
        nonce,
      });
    });

    it("only ever returns to a player page", async () => {
      const { readLoginState } = await ctx.importFromBack("server/src/utils/googleSignIn.js");
      for (const bad of ["https://evil.test/", "//evil.test", "/admin/users", "/book//evil", "/me/games?x=<y>"]) {
        const { state } = await start(bad);
        assert.equal(readLoginState(state).returnPath, "/me/games", bad);
      }
    });

    it("comes back with a single-use code, traded once for a session", async () => {
      const started = await start(`/book/${home.token}`);
      const back = await callback(started);
      assert.equal(back.origin + back.pathname, `${APP}/signed-in`);
      assert.equal(back.searchParams.get("next"), `/book/${home.token}`);
      const code = back.searchParams.get("code");
      assert.ok(code && !back.search.includes("token"));

      const first = await ctx.api("POST", "/player/session", { body: { code } });
      assert.equal(first.status, 200, JSON.stringify(first.body));
      const me = await ctx.api("GET", "/player/me", { player: first.data.accessToken.token });
      assert.equal(me.status, 200);
      // A first sign-in: the profile isn't complete yet, its names come from Google
      assert.deepEqual(me.data.player, {
        firstName: "Ana",
        middleName: "",
        lastName: "Reyes",
        name: "Ana Reyes",
        email: "ana@example.test",
        photoUrl: "https://lh3.googleusercontent.com/ana",
        phone: null,
        profileComplete: false,
      });

      const again = await ctx.api("POST", "/player/session", { body: { code } });
      assert.equal(again.status, 400);
    });

    it("refuses an expired code", async () => {
      const back = await callback(await start());
      const code = back.searchParams.get("code");
      const { hashToken } = await ctx.importFromBack("server/src/utils/crypto/tokens.js");
      await ctx.sql.query(
        `UPDATE player_sign_in_codes SET expiresAt = '2020-01-01 00:00:00' WHERE codeHash = ?`,
        [hashToken(code)]
      );
      assert.equal((await ctx.api("POST", "/player/session", { body: { code } })).status, 400);
    });

    it("signs the same Google account into the same player, with Google's latest name", async () => {
      await signIn({ sub: "google-sub-ben", email: "ben@example.test", name: "Ben" });
      const session = await signIn({ sub: "google-sub-ben", email: "ben@example.test", name: "Benjie" });
      const me = await ctx.api("GET", "/player/me", { player: session.token });
      assert.equal(me.data.player.name, "Benjie");
      const [rows] = await ctx.sql.query(`SELECT COUNT(*) AS n FROM players WHERE googleSub = 'google-sub-ben'`);
      assert.equal(rows[0].n, 1);
    });

    it("says why when it can't sign in, and makes no player", async () => {
      const outcome = async (started, claims) =>
        (await callback(started, claims)).searchParams.get("error");
      const before = (await ctx.sql.query(`SELECT COUNT(*) AS n FROM players`))[0][0].n;

      assert.equal(await outcome(await start(), { email_verified: false }), "refused");
      assert.equal(await outcome(await start(), { aud: "another-app" }), "failed");
      assert.equal(await outcome(await start(), { iss: "https://evil.test" }), "failed");
      assert.equal(await outcome(await start(), { nonce: "not-the-one" }), "failed");
      assert.equal(await outcome(await start(), { exp: 1_000_000 }), "failed");

      const cancelled = await go(
        `/api/v1/auth/google/callback?error=access_denied&state=${encodeURIComponent((await start()).state)}`
      );
      assert.equal(cancelled.searchParams.get("error"), "cancelled");
      const forged = await go("/api/v1/auth/google/callback?code=x&state=forged");
      assert.equal(forged.searchParams.get("error"), "expired");
      const refusedByGoogle = await go(
        `/api/v1/auth/google/callback?code=refuse&state=${encodeURIComponent((await start()).state)}`
      );
      assert.equal(refusedByGoogle.searchParams.get("error"), "failed");

      assert.equal((await ctx.sql.query(`SELECT COUNT(*) AS n FROM players`))[0][0].n, before);
    });

    it("refuses a Blocked player, and their old session stops working", async () => {
      const session = await signIn({ sub: "google-sub-cara", email: "cara@example.test" });
      await ctx.sql.query(`UPDATE players SET status = 'Blocked' WHERE googleSub = 'google-sub-cara'`);
      assert.equal((await ctx.api("GET", "/player/me", { player: session.token })).status, 401);
      const back = await callback(await start(), { sub: "google-sub-cara", email: "cara@example.test" });
      assert.equal(back.searchParams.get("error"), "refused");
      const refreshed = await ctx.api("POST", "/player/session/refresh", {
        body: { refreshToken: session.refreshToken },
      });
      assert.equal(refreshed.status, 401);
    });
  });

  describe("sessions", () => {
    it("rotates the refresh token, and a reused one ends every session", async () => {
      const session = await signIn({ sub: "google-sub-dan", email: "dan@example.test" });
      const next = await ctx.api("POST", "/player/session/refresh", {
        body: { refreshToken: session.refreshToken },
      });
      assert.equal(next.status, 200, JSON.stringify(next.body));
      const newer = next.data.refreshToken.token;
      assert.notEqual(newer, session.refreshToken);

      // The old one again: refused, and the newer one is revoked with it
      const reused = await ctx.api("POST", "/player/session/refresh", {
        body: { refreshToken: session.refreshToken },
      });
      assert.equal(reused.status, 401);
      assert.equal(reused.body.code, "TOKEN_INVALID");
      const after = await ctx.api("POST", "/player/session/refresh", { body: { refreshToken: newer } });
      assert.equal(after.status, 401);
    });

    it("signs out", async () => {
      const session = await signIn({ sub: "google-sub-eve", email: "eve@example.test" });
      const out = await ctx.api("POST", "/player/session/logout", {
        body: { refreshToken: session.refreshToken },
      });
      assert.equal(out.status, 200);
      const refreshed = await ctx.api("POST", "/player/session/refresh", {
        body: { refreshToken: session.refreshToken },
      });
      assert.equal(refreshed.status, 401);
    });

    it("keeps player and staff sign-ins apart", async () => {
      const player = await signIn({ sub: "google-sub-fay", email: "fay@example.test" });
      // A player token as a staff token
      assert.equal((await ctx.api("GET", "/admin/users", { token: player.token })).status, 401);
      // A staff token as a player token, and a player route with no token
      assert.equal((await ctx.api("GET", "/player/me", { player: admin.token })).status, 401);
      const none = await ctx.api("GET", "/player/me");
      assert.equal(none.status, 401);
      assert.equal(none.body.code, "PLAYER_SIGN_IN_REQUIRED");
      // A staff refresh token can't make a player session, nor the reverse
      assert.equal(
        (await ctx.api("POST", "/player/session/refresh", { body: { refreshToken: admin.refreshToken } })).status,
        401
      );
      const staffRefresh = await ctx.api("POST", "/admin/auth/refresh", {
        body: { refreshToken: player.refreshToken },
      });
      assert.equal(staffRefresh.status, 401);
    });
  });

  describe("the first-sign-in profile", () => {
    it("can't book until the profile is complete", async () => {
      const jo = await signIn({ sub: "google-sub-jo", email: "jo@example.test", given_name: "Jo", family_name: "Lim" });
      const me = await ctx.api("GET", "/player/me", { player: jo.token });
      assert.equal(me.data.player.profileComplete, false);
      assert.equal(me.data.player.firstName, "Jo");
      assert.equal(me.data.player.lastName, "Lim");
      const refused = await ctx.api("POST", `/public/book/${home.token}/bookings`, {
        player: jo.token,
        body: { courtKey: home.courtKey, ...slot(100), durationMinutes: 60 },
      });
      assert.equal(refused.status, 409);
      assert.equal(refused.body.code, "PROFILE_INCOMPLETE");
      const [[count]] = await ctx.sql.query(
        `SELECT COUNT(*) AS n FROM bookings b JOIN players p ON p.playerId = b.playerId
         WHERE p.googleSub = 'google-sub-jo'`
      );
      assert.equal(count.n, 0);
    });

    it("needs a first and last name; the middle name and phone are optional, a phone must be valid", async () => {
      const kai = await signIn({ sub: "google-sub-kai", email: "kai@example.test" });
      const patch = (body) => ctx.api("PATCH", "/player/me", { player: kai.token, body });
      const good = { firstName: "Kai", lastName: "Tan", phone: "09171112222" };
      assert.equal((await patch({ ...good, firstName: " " })).status, 400);
      assert.equal((await patch({ ...good, lastName: "" })).status, 400);
      assert.equal((await patch({ ...good, phone: "12345" })).status, 400);
      assert.equal((await patch({ ...good, firstName: "x".repeat(51) })).status, 400);
      const me = await ctx.api("GET", "/player/me", { player: kai.token });
      assert.equal(me.data.player.profileComplete, false, "nothing saved by a refused one");
      assert.equal((await patch({ ...good, lastName: undefined })).status, 400);

      // No phone is fine
      const noPhone = await patch({ firstName: "Kai", lastName: "Tan", phone: "" });
      assert.equal(noPhone.status, 200, JSON.stringify(noPhone.body));
      assert.equal(noPhone.data.player.phone, null);
      assert.equal(noPhone.data.player.profileComplete, true);

      const saved = await patch({ ...good, middleName: "" });
      assert.equal(saved.status, 200, JSON.stringify(saved.body));
      assert.deepEqual(
        {
          name: saved.data.player.name,
          middleName: saved.data.player.middleName,
          phone: saved.data.player.phone,
          profileComplete: saved.data.player.profileComplete,
        },
        { name: "Kai Tan", middleName: "", phone: "0917 1112 222", profileComplete: true }
      );
    });

    it("keeps the player's own names after that, whatever Google says later", async () => {
      const lea = await signIn({ sub: "google-sub-lea", email: "lea@example.test" });
      await completeProfile(lea, { firstName: "Lea", middleName: "Q.", lastName: "Ramos" });
      const later = await signIn({
        sub: "google-sub-lea",
        email: "lea.new@example.test",
        name: "Leah R",
        given_name: "Leah",
        family_name: "R",
      });
      const me = (await ctx.api("GET", "/player/me", { player: later.token })).data.player;
      assert.equal(me.name, "Lea Q. Ramos");
      assert.equal(me.firstName, "Lea");
      assert.equal(me.email, "lea.new@example.test", "the email still follows Google");
      assert.equal(me.profileComplete, true);
    });

    it("needs a signed-in player to save a profile", async () => {
      const res = await ctx.api("PATCH", "/player/me", {
        body: { firstName: "No", lastName: "One", phone: "09170000000" },
      });
      assert.equal(res.status, 401);
    });
  });

  describe("booking and the game log", () => {
    it("the venue list and booking page say a sign-in is needed, and that it's available", async () => {
      const page = await ctx.api("GET", `/public/book/${home.token}`);
      assert.equal(page.data.signInRequired, true);
      assert.equal(page.data.signInAvailable, true);
      // /book, the venue list, says so too (it asks for the sign-in first)
      const venues = await ctx.api("GET", "/public/venues");
      assert.equal(venues.data.signInAvailable, true);
    });

    it("books as the signed-in player, whatever name or email the page sends", async () => {
      const gia = await signIn({ sub: "google-sub-gia", email: "gia@example.test", name: "Gia Santos" });
      await completeProfile(gia, { firstName: "Gia", middleName: "M.", lastName: "Santos", phone: "0918 222 3333" });
      const res = await ctx.api("POST", `/public/book/${home.token}/bookings`, {
        player: gia.token,
        body: {
          courtKey: home.courtKey,
          ...slot(30),
          durationMinutes: 60,
          playerName: "Someone Else",
          email: "someone@example.test",
          phone: "09171234567",
                  },
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      const [[row]] = await ctx.sql.query(
        `SELECT b.playerName, b.email, b.phone, p.googleSub
         FROM bookings b JOIN players p ON p.playerId = b.playerId
         WHERE b.bookingCode = ?`,
        [res.data.bookingCode]
      );
      assert.deepEqual(row, {
        playerName: "Gia M. Santos",
        email: "gia@example.test",
        phone: "0917 1234 567",
        googleSub: "google-sub-gia",
      });
      // No phone on the booking: the profile's
      const second = await ctx.api("POST", `/public/book/${home.token}/bookings`, {
        player: gia.token,
        body: { courtKey: home.courtKey, ...slot(32), durationMinutes: 60 },
      });
      assert.equal(second.status, 201, JSON.stringify(second.body));
      const [[again]] = await ctx.sql.query(`SELECT phone FROM bookings WHERE bookingCode = ?`, [
        second.data.bookingCode,
      ]);
      assert.equal(again.phone, "0918 2223 333");
    });

    it("lists the player's bookings — booked signed in, or earlier with their email — and their games", async () => {
      const hana = await signIn({ sub: "google-sub-hana", email: "hana@example.test", name: "Hana" });
      await completeProfile(hana, { firstName: "Hana", lastName: "Cruz" });
      // Booked online while signed in
      const online = await ctx.api("POST", `/public/book/${home.token}/bookings`, {
        player: hana.token,
        body: { courtKey: home.courtKey, ...slot(50), durationMinutes: 60 },
      });
      assert.equal(online.status, 201, JSON.stringify(online.body));
      // Booked at the desk earlier with her email (any case), and played: a game with a Drive folder
      const desk = await call("POST", "/admin/bookings", {
        courtId: home.courtId,
        ...slot(0),
        durationMinutes: 60,
        playerName: "Hana",
        email: "HANA@example.test",
        payment: "Hold",
      });
      assert.equal(desk.status, 201, JSON.stringify(desk.body));
      await ctx.payBooking(desk.data.bookingId);
      const detail = await call("GET", `/admin/bookings/${desk.data.bookingId}`);
      const manageToken = detail.data.booking.manageUrl.split("/booking/")[1];
      const checkIn = await ctx.api("POST", `/public/bookings/${manageToken}/check-in`);
      assert.equal(checkIn.status, 201, JSON.stringify(checkIn.body));
      await ctx.sql.query(
        `UPDATE recording_sessions SET status = 'Ready', driveUrl = 'https://drive.google.com/drive/folders/abc'
         WHERE bookingId = ?`,
        [desk.data.bookingId]
      );
      // Someone else's booking
      const other = await call("POST", "/admin/bookings", {
        courtId: home.courtId,
        ...slot(70),
        durationMinutes: 60,
        playerName: "Ivan",
        email: "ivan@example.test",
        payment: "Free",
      });
      assert.equal(other.status, 201);

      const log = await ctx.api("GET", "/player/games", { player: hana.token });
      assert.equal(log.status, 200, JSON.stringify(log.body));
      const codes = [...log.data.upcoming, ...log.data.past].map((b) => b.bookingCode);
      assert.ok(codes.includes(online.data.bookingCode));
      assert.ok(codes.includes(desk.data.bookingCode));
      assert.ok(!codes.includes(other.data.bookingCode));

      const played = [...log.data.upcoming, ...log.data.past].find(
        (b) => b.bookingCode === desk.data.bookingCode
      );
      assert.equal(played.games.length, 1);
      assert.equal(played.games[0].driveUrl, "https://drive.google.com/drive/folders/abc");
      assert.match(played.games[0].gameUrl, /^http:\/\/app\.test\/session\/[\w-]{16,}$/);
      assert.match(played.bookingUrl, /^http:\/\/app\.test\/booking\/[\w-]{16,}$/);
      // No business IDs in the log
      assert.ok(!JSON.stringify(log.body).includes(desk.data.bookingId));
      assert.ok(!JSON.stringify(log.body).includes(home.courtId));
    });

    it("leaves deleted bookings out of the game log", async () => {
      const ivy = await signIn({ sub: "google-sub-ivy", email: "ivy@example.test" });
      await completeProfile(ivy);
      const made = await ctx.api("POST", `/public/book/${home.token}/bookings`, {
        player: ivy.token,
        body: { courtKey: home.courtKey, ...slot(90), durationMinutes: 60 },
      });
      assert.equal(made.status, 201, JSON.stringify(made.body));
      const before = await ctx.api("GET", "/player/games", { player: ivy.token });
      assert.equal(before.data.upcoming.length, 1);
      await ctx.sql.query(`UPDATE bookings SET status = 'Deleted' WHERE bookingCode = ?`, [
        made.data.bookingCode,
      ]);
      const after = await ctx.api("GET", "/player/games", { player: ivy.token });
      assert.equal(after.data.upcoming.length + after.data.past.length, 0);
    });
  });
});
