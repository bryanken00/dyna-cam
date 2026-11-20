// CR-018 — the player's email on New game gets the game's Google Drive link
// once its videos are in Drive and the game is paid (or free). Every email goes
// through SendGrid when SENDGRID_API_KEY is set. SendGrid is a fake server here;
// the game's Drive state is set directly (the upload itself is
// google-drive.test.js).

import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

const SENDGRID_KEY = "SG.test-key";

/** A fake SendGrid Web API v3: POST /v3/mail/send. */
const fakeSendgrid = () => {
  const state = { messages: [], fail: null, auth: [] };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      state.auth.push(req.headers.authorization);
      if (req.method !== "POST" || req.url !== "/v3/mail/send") {
        res.writeHead(404).end();
        return;
      }
      if (req.headers.authorization !== `Bearer ${SENDGRID_KEY}`) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ errors: [{ message: "The provided authorization grant is invalid" }] }));
        return;
      }
      if (state.fail) {
        const { status, message } = state.fail;
        state.fail = null;
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ errors: [{ message }] }));
        return;
      }
      state.messages.push(JSON.parse(Buffer.concat(chunks).toString()));
      res.writeHead(202, { "X-Message-Id": `msg-${state.messages.length}` }).end();
    });
  });
  return { server, state };
};

describe("Google Drive link by email (CR-018)", () => {
  let ctx;
  let admin;
  let viewer;
  let sendgrid;
  let runDriveEmails;
  let courtNo = 0;
  const home = {};

  const call = (method, url, body, who = admin) => ctx.api(method, url, { token: who.token, body });

  /** A game on its own court, started now. */
  const newGame = async (body = {}) => {
    courtNo += 1;
    const court = await call("POST", "/admin/courts", {
      venueId: home.venueId,
      name: `Court ${courtNo}`,
      cameraRtspUrl: `rtsp://u:p@10.0.3.${courtNo}:554/stream1`,
    });
    const res = await call("POST", "/admin/sessions", {
      courtId: court.data.courtId,
      startNow: true,
      durationMinutes: 30,
      playerName: "Ana Reyes",
      email: "ana@player.test",
      ...body,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.data.sessionId;
  };

  /**
   * End the game and make its whole video Ready — in Drive (`drive`), still
   * uploading (`"uploading"`), or not in Drive (`false`).
   */
  const finish = async (sessionId, drive = true) => {
    await ctx.sql.query(
      `UPDATE recording_sessions
       SET startAt = DATE_SUB(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'), INTERVAL 40 MINUTE),
           endAt = DATE_SUB(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'), INTERVAL 10 MINUTE)
       WHERE sessionId = ?`,
      [sessionId]
    );
    await call("GET", `/admin/sessions/${sessionId}`); // ends it: its video rows are made
    await ctx.sql.query(
      `UPDATE session_videos
       SET status = 'Ready', videoPath = '/public/uploads/admin/x.mp4',
           expiresAt = DATE_ADD(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'), INTERVAL 1 DAY),
           driveStatus = ?, driveFileId = ?, driveUrl = ?
       WHERE sessionId = ?`,
      [
        drive === true ? "Uploaded" : drive === "uploading" ? "Uploading" : null,
        drive === true ? `file-${sessionId}` : null,
        drive === true ? `https://drive.test/file/${sessionId}` : null,
        sessionId,
      ]
    );
    if (drive) {
      await ctx.sql.query(`UPDATE recording_sessions SET driveUrl = ? WHERE sessionId = ?`, [
        `https://drive.test/folders/${sessionId}`,
        sessionId,
      ]);
    }
    const shown = await call("GET", `/admin/sessions/${sessionId}`);
    assert.equal(shown.data.session.status, "Ready");
    return shown.data.session;
  };

  const pay = (sessionId) => call("POST", "/admin/payments", { sessionId, amount: 300 });
  const state = async (sessionId) =>
    (await call("GET", `/admin/sessions/${sessionId}`)).data.session.driveEmail;
  const mailsTo = (sessionId) =>
    sendgrid.state.messages.filter((m) =>
      m.content.some((c) => c.value.includes(`https://drive.test/folders/${sessionId}`))
    );

  before(async () => {
    sendgrid = fakeSendgrid();
    await new Promise((resolve) => sendgrid.server.listen(0, "127.0.0.1", resolve));
    ctx = await startTestApp({
      env: {
        SENDGRID_API_KEY: SENDGRID_KEY,
        SENDGRID_API_URL: `http://127.0.0.1:${sendgrid.server.address().port}`,
        MAIL_FROM: "Dyna Cam <no-reply@dynacam.test>",
      },
    });
    ({ runDriveEmails } = await ctx.importFromBack("server/src/jobs/driveEmails.js"));
    admin = await ctx.createStaff("Admin", { access: "write" });
    viewer = await ctx.createStaff("Viewer", { access: "read" });
    home.venueId = (await call("POST", "/admin/venues", { name: "Mail Courts" })).data.venueId;
  });
  after(async () => {
    await ctx?.stop();
    sendgrid?.server.close();
  });

  it("takes the player's email on New game, and refuses a wrong one", async () => {
    const sessionId = await newGame();
    const shown = await call("GET", `/admin/sessions/${sessionId}`);
    assert.equal(shown.data.session.email, "ana@player.test");
    assert.equal(shown.data.session.driveEmail.status, "WaitingForGame");

    const wrong = await call("POST", "/admin/sessions", {
      courtId: (await ctx.sql.query(`SELECT courtId FROM courts LIMIT 1`))[0][0].courtId,
      startNow: true,
      durationMinutes: 30,
      email: "not-an-email",
    });
    assert.equal(wrong.status, 400);
  });

  it("emails the Drive link once the game is in Drive and paid — once", async () => {
    const sessionId = await newGame();
    await finish(sessionId);
    assert.equal((await state(sessionId)).status, "WaitingForPayment");
    assert.deepEqual(await runDriveEmails(ctx.db), {}, "not while unpaid");

    assert.equal((await pay(sessionId)).status, 201);
    assert.equal((await state(sessionId)).status, "Queued");
    assert.deepEqual(await runDriveEmails(ctx.db), { sent: 1 });

    const [mail] = mailsTo(sessionId);
    assert.ok(mail, "SendGrid got the email");
    assert.deepEqual(mail.personalizations, [{ to: [{ email: "ana@player.test" }] }]);
    assert.deepEqual(mail.from, { name: "Dyna Cam", email: "no-reply@dynacam.test" });
    assert.match(mail.subject, /Mail Courts/);
    const html = mail.content.find((c) => c.type === "text/html").value;
    assert.match(html, /Hi Ana Reyes/);
    assert.match(html, /Open your game in Google Drive/);
    assert.match(html, /deleted after that/);

    const sent = await state(sessionId);
    assert.equal(sent.status, "Sent");
    assert.equal(sent.to, "ana@player.test");
    assert.ok(sent.sentAt);

    assert.deepEqual(await runDriveEmails(ctx.db), {}, "never twice");
    assert.equal(mailsTo(sessionId).length, 1);
  });

  it("sends a free game's link at once", async () => {
    const sessionId = await newGame({ free: true });
    await finish(sessionId);
    assert.deepEqual(await runDriveEmails(ctx.db), { sent: 1 });
    assert.equal(mailsTo(sessionId).length, 1);
  });

  it("waits while the Drive upload is still going", async () => {
    const sessionId = await newGame({ free: true });
    await finish(sessionId, "uploading");
    assert.equal((await state(sessionId)).status, "WaitingForDrive");
    assert.deepEqual(await runDriveEmails(ctx.db), {});
  });

  it("sends nothing for a court without Drive, or a game without an email", async () => {
    const noDrive = await newGame({ free: true });
    await finish(noDrive, false);
    assert.equal((await state(noDrive)).status, "NoDrive");

    const noEmail = await newGame({ free: true, email: "" });
    await finish(noEmail);
    assert.equal((await state(noEmail)).status, "NoEmail");

    assert.deepEqual(await runDriveEmails(ctx.db), {});
    assert.equal(mailsTo(noEmail).length, 0);
  });

  it("retries when SendGrid refuses, then sends", async () => {
    const sessionId = await newGame({ free: true });
    await finish(sessionId);
    sendgrid.state.fail = { status: 500, message: "Internal error" };
    assert.deepEqual(await runDriveEmails(ctx.db), { retry: 1 });
    const waiting = await state(sessionId);
    assert.equal(waiting.status, "Queued");
    assert.match(waiting.error, /SendGrid refused the email: Internal error/);
    assert.deepEqual(await runDriveEmails(ctx.db), {}, "not before its retry time");

    await ctx.sql.query(
      `UPDATE recording_sessions SET driveEmailNextAttemptAt = NULL WHERE sessionId = ?`,
      [sessionId]
    );
    assert.deepEqual(await runDriveEmails(ctx.db), { sent: 1 });
    assert.equal((await state(sessionId)).error, null);
  });

  it("lets staff fix the email; the new address gets the link", async () => {
    const sessionId = await newGame({ free: true, email: "typo@player" + ".tes" });
    await finish(sessionId);
    await runDriveEmails(ctx.db);
    assert.equal((await state(sessionId)).to, "typo@player.tes");

    const viewerTry = await call(
      "PATCH",
      `/admin/sessions/${sessionId}/email`,
      { email: "ana@player.test" },
      viewer
    );
    assert.equal(viewerTry.status, 403);
    assert.equal(
      (await call("PATCH", `/admin/sessions/${sessionId}/email`, { email: "bad" })).status,
      400
    );

    const fixed = await call("PATCH", `/admin/sessions/${sessionId}/email`, {
      email: "ana.reyes@player.test",
    });
    assert.equal(fixed.status, 200, JSON.stringify(fixed.body));
    assert.equal(fixed.data.session.email, "ana.reyes@player.test");
    assert.equal(fixed.data.session.driveEmail.status, "Queued");
    assert.deepEqual(await runDriveEmails(ctx.db), { sent: 1 });
    assert.equal((await state(sessionId)).to, "ana.reyes@player.test");
  });

  it("sends it again on request, and says why when it can't", async () => {
    const sessionId = await newGame();
    await finish(sessionId);

    const unpaid = await call("POST", `/admin/sessions/${sessionId}/drive-email`);
    assert.equal(unpaid.status, 409);
    assert.match(unpaid.body.message, /isn't paid/);

    await pay(sessionId);
    await runDriveEmails(ctx.db);
    const again = await call("POST", `/admin/sessions/${sessionId}/drive-email`);
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.match(again.body.message, /emailed to ana@player.test/);
    assert.equal(mailsTo(sessionId).length, 2);

    sendgrid.state.fail = { status: 403, message: "The from address does not match a verified Sender Identity" };
    const refused = await call("POST", `/admin/sessions/${sessionId}/drive-email`);
    assert.equal(refused.status, 502);
    assert.match(refused.body.message, /verified Sender Identity/);
    const after = await state(sessionId);
    assert.equal(after.status, "Sent", "the earlier email still counts");
    assert.match(after.error, /verified Sender Identity/);

    const noDrive = await newGame({ free: true });
    await finish(noDrive, false);
    assert.equal((await call("POST", `/admin/sessions/${noDrive}/drive-email`)).status, 409);
    assert.equal((await call("POST", `/admin/sessions/no-such-game/drive-email`)).status, 404);
    assert.equal(
      (await call("PATCH", `/admin/sessions/no-such-game/email`, { email: "a@b.test" })).status,
      404
    );
  });

  it("treats a game in a deleted venue as missing and leaves it alone", async () => {
    const venueId = (await call("POST", "/admin/venues", { name: "Closed Courts" })).data.venueId;
    const court = await call("POST", "/admin/courts", {
      venueId,
      name: "Last Court",
      cameraRtspUrl: "rtsp://u:p@10.0.4.1:554/stream1",
    });
    const game = await call("POST", "/admin/sessions", {
      courtId: court.data.courtId,
      startNow: true,
      durationMinutes: 30,
      email: "ana@player.test",
    });
    await call("DELETE", `/admin/venues/${venueId}`);
    const res = await call("PATCH", `/admin/sessions/${game.data.sessionId}/email`, {
      email: "other@player.test",
    });
    assert.equal(res.status, 404);
    assert.equal((await call("POST", `/admin/sessions/${game.data.sessionId}/drive-email`)).status, 404);
    const [[row]] = await ctx.sql.query(`SELECT email FROM recording_sessions WHERE sessionId = ?`, [
      game.data.sessionId,
    ]);
    assert.equal(row.email, "ana@player.test");
  });

  it("holds the email while SendGrid isn't set up — never counts it as sent", async () => {
    const sessionId = await newGame({ free: true });
    await finish(sessionId);
    process.env.SENDGRID_API_KEY = "";
    try {
      assert.equal((await state(sessionId)).status, "NotSetUp");
      assert.deepEqual(await runDriveEmails(ctx.db), {});
      const now = await call("POST", `/admin/sessions/${sessionId}/drive-email`);
      assert.equal(now.status, 409);
      assert.match(now.body.message, /SENDGRID_API_KEY/);
    } finally {
      process.env.SENDGRID_API_KEY = SENDGRID_KEY;
    }
    assert.deepEqual(await runDriveEmails(ctx.db), { sent: 1 }, "goes once it's set up");
  });

  it("sends other emails through SendGrid too (password reset)", async () => {
    const before = sendgrid.state.messages.length;
    const res = await ctx.api("POST", "/admin/auth/forgot-password", { body: { email: viewer.email } });
    assert.equal(res.status, 200);
    const mail = sendgrid.state.messages[before];
    assert.ok(mail, "the reset email went to SendGrid");
    assert.deepEqual(mail.personalizations[0].to, [{ email: viewer.email }]);
    assert.ok(sendgrid.state.auth.every((a) => a === `Bearer ${SENDGRID_KEY}`));
  });
});
