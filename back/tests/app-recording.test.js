// PLAN-002 Phase D — a paired staff phone records a whole game: Start
// recording creates a recording session from now (capped at 3 h or the
// court's next booking), End recording finishes it, and the game's share link
// works straight away while its 5-minute parts are cut and uploaded.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { JPEG, startTestApp } from "./helpers/testApp.js";

const MP4 = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from("ftypisom"),
  Buffer.alloc(64, 1),
]);

describe("whole-game recording from a paired phone", () => {
  let ctx;
  let admin;
  const home = {};
  const other = {};

  const call = (method, url, body) => ctx.api(method, url, { token: admin.token, body });
  const asApp = (token) => (method, url, body) =>
    ctx.api(method, url, { body, headers: { Authorization: `App ${token}` } });
  const asDevice =
    (token) =>
    (method, url, options = {}) =>
      ctx.api(method, url, { ...options, headers: { Authorization: `Device ${token}` } });

  /** "YYYY-MM-DD HH:mm:ss" in Manila, `minutes` from now (negative = ago). */
  const manila = async (minutes) => {
    const [[row]] = await ctx.sql.query(
      `SELECT DATE_FORMAT(DATE_ADD(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'),
               INTERVAL ? SECOND), '%Y-%m-%d %H:%i:%s') AS t`,
      [Math.round(minutes * 60)]
    );
    return row.t;
  };

  const newKey = async (kind, venueId, name) => {
    const res = await call("POST", `/admin/pairing-codes/${kind}`, { venueId, name });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.data.code;
  };

  const addCourt = async (target, name, withCamera = true) => {
    const court = await call("POST", "/admin/courts", {
      venueId: target.venueId,
      name,
      ...(withCamera ? { cameraRtspUrl: "rtsp://u:p@10.0.0.9:554/stream1" } : {}),
    });
    assert.equal(court.status, 201, JSON.stringify(court.body));
    return court.data.courtId;
  };

  before(async () => {
    ctx = await startTestApp({
      env: { RATE_LIMIT_PAIR_POINTS: "1000", RATE_LIMIT_PAIR_HOURLY_POINTS: "1000" },
    });
    admin = await ctx.createStaff("Admin", { access: "write" });
    for (const [target, name] of [
      [home, "Game Courts"],
      [other, "Other Courts"],
    ]) {
      target.venueId = (await call("POST", "/admin/venues", { name })).data.venueId;
      target.courtId = await addCourt(target, "Court 1");
      const box = await ctx.api("POST", "/pair/device", {
        body: { code: await newKey("recorders", target.venueId, "Box"), agentVersion: "1.0.0" },
      });
      target.device = asDevice(box.data.token);
      await target.device("GET", "/device/config"); // the box is online
      const phone = await ctx.api("POST", "/pair/app", {
        body: {
          code: await newKey("apps", target.venueId, "Desk phone"),
          platform: "android",
          appVersion: "1.0.0",
        },
      });
      target.phone = asApp(phone.data.token);
    }
    home.noCamera = await addCourt(home, "Court 9", false);
    home.booked = await addCourt(home, "Court 2");
  });
  after(() => ctx?.stop());

  let game;

  it("starts recording a court, and a second Start gets the same game", async () => {
    const started = await home.phone("POST", `/app/courts/${home.courtId}/recording`);
    assert.equal(started.status, 201, JSON.stringify(started.body));
    game = started.data.recording;
    assert.equal(game.already, false);
    assert.match(game.shareUrl, /\/session\//);
    assert.equal(game.startedBy, "Desk phone");
    assert.ok(game.endsInSeconds > 3 * 60 * 60 - 60, "stops by itself after 3 hours");

    const again = await home.phone("POST", `/app/courts/${home.courtId}/recording`);
    assert.equal(again.status, 200);
    assert.equal(again.data.recording.sessionId, game.sessionId);
    assert.equal(again.data.recording.already, true);

    const courts = await home.phone("GET", "/app/courts");
    const court = courts.data.courts.find((c) => c.courtId === home.courtId);
    assert.equal(court.recording.sessionId, game.sessionId);
    assert.ok(court.recording.elapsedSeconds >= 0);

    const listed = await call("GET", `/admin/sessions?courtId=${home.courtId}`);
    assert.equal(listed.data.sessions[0].startedBy, "Desk phone (phone)");
  });

  it("ends it: the footage so far becomes parts and the court is free again", async () => {
    // Pretend the game has run for 7 minutes → 2 parts
    await ctx.sql.query(`UPDATE recording_sessions SET startAt = ? WHERE sessionId = ?`, [
      await manila(-7),
      game.sessionId,
    ]);
    const ended = await home.phone("POST", `/app/courts/${home.courtId}/recording/end`);
    assert.equal(ended.status, 200, JSON.stringify(ended.body));
    const session = ended.data.session;
    assert.equal(session.status, "Processing");
    assert.equal(session.partsTotal, 2);
    assert.equal(session.shareUrl, game.shareUrl);
    assert.ok(session.durationSeconds >= 7 * 60 - 5 && session.durationSeconds <= 7 * 60 + 5);

    const courts = await home.phone("GET", "/app/courts");
    assert.equal(courts.data.courts.find((c) => c.courtId === home.courtId).recording, null);
    assert.equal(
      (await home.phone("POST", `/app/courts/${home.courtId}/recording/end`)).status,
      409
    );

    // The box cuts and uploads both parts → the game is Ready
    const jobs = (await home.device("GET", "/device/jobs?wait=0")).data.jobs.filter(
      (j) => j.sessionId === game.sessionId
    );
    assert.equal(jobs.length, 2);
    for (const job of jobs) {
      const res = await home.device("POST", `/device/clips/${job.clipId}/upload`, {
        form: [
          ["video", MP4, "video/mp4", "part.mp4"],
          ["thumbnail", JPEG, "image/jpeg", "part.jpg"],
        ],
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));
    }
    const ready = await home.phone("GET", `/app/sessions/${game.sessionId}`);
    assert.equal(ready.data.session.status, "Ready");
    assert.equal(ready.data.session.partsReady, 2);
  });

  it("lists games on the court, and keeps game parts out of the 60-second clips", async () => {
    const games = await home.phone("GET", `/app/courts/${home.courtId}/sessions`);
    assert.equal(games.status, 200);
    assert.equal(games.data.sessions[0].sessionId, game.sessionId);
    const clips = await home.phone("GET", `/app/courts/${home.courtId}/clips`);
    assert.equal(clips.data.clips.length, 0);
  });

  it("refuses a court without a camera, and a court booked within 5 minutes", async () => {
    const noCamera = await home.phone("POST", `/app/courts/${home.noCamera}/recording`);
    assert.equal(noCamera.status, 503);
    assert.equal(noCamera.body.code, "CAMERA_OFFLINE");

    const booking = await call("POST", "/admin/sessions", {
      courtId: home.booked,
      startAt: (await manila(3)).slice(0, 16),
      durationMinutes: 30,
    });
    assert.equal(booking.status, 201, JSON.stringify(booking.body));
    const soon = await home.phone("POST", `/app/courts/${home.booked}/recording`);
    assert.equal(soon.status, 409);
    assert.match(soon.body.message, /booked from/);

    // A booking further away just shortens the game
    await ctx.sql.query(`UPDATE recording_sessions SET startAt = ?, endAt = ? WHERE sessionId = ?`, [
      await manila(30),
      await manila(60),
      booking.data.sessionId,
    ]);
    const capped = await home.phone("POST", `/app/courts/${home.booked}/recording`);
    assert.equal(capped.status, 201, JSON.stringify(capped.body));
    assert.ok(capped.data.recording.endsInSeconds <= 30 * 60);
  });

  it("can't see or touch another venue's courts and games", async () => {
    assert.equal((await other.phone("POST", `/app/courts/${home.courtId}/recording`)).status, 404);
    assert.equal(
      (await other.phone("POST", `/app/courts/${home.courtId}/recording/end`)).status,
      404
    );
    assert.equal((await other.phone("GET", `/app/courts/${home.courtId}/sessions`)).status, 404);
    assert.equal((await other.phone("GET", `/app/sessions/${game.sessionId}`)).status, 404);
  });

  it("an End right after Start still keeps a short game", async () => {
    const started = await other.phone("POST", `/app/courts/${other.courtId}/recording`);
    assert.equal(started.status, 201);
    const ended = await other.phone("POST", `/app/courts/${other.courtId}/recording/end`);
    assert.equal(ended.status, 200);
    assert.equal(ended.data.session.partsTotal, 1);

    // The court is free straight away: a new Start is a new game
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const next = await other.phone("POST", `/app/courts/${other.courtId}/recording`);
    assert.equal(next.status, 201, JSON.stringify(next.body));
    assert.notEqual(next.data.recording.sessionId, started.data.recording.sessionId);
  });
});
