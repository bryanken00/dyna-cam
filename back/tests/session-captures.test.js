// CR-013 — during a game, the paired courtside device saves "the last N
// minutes" as its own video (up to 5 at once, queued, deletable). It is the whole-game pipeline over a shorter
// window: one session_videos row per camera with captureId set, a box "game"
// job with the save's window, free. The whole game and its settling are
// unaffected.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

describe("saving the last few minutes (captures)", () => {
  let ctx;
  let admin;
  const home = {};

  const call = (method, url, body) => ctx.api(method, url, { token: admin.token, body });
  const asDevice = (token) => (method, url, options = {}) =>
    ctx.api(method, url, { ...options, headers: { Authorization: `Device ${token}` } });
  const asApp = (token) => (method, url, body) =>
    ctx.api(method, url, { body, headers: { Authorization: `App ${token}` } });

  /** A new open game on `courtId`, paired to a device (which starts it recording). */
  const startGame = async (courtId, extra = {}) => {
    const created = await call("POST", "/admin/sessions", { courtId, ...extra });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const key = await call("POST", `/admin/sessions/${created.data.sessionId}/pairing-codes`, {
      name: "Courtside tablet",
    });
    const paired = await ctx.api("POST", "/pair/app", { body: { code: key.data.code } });
    assert.equal(paired.status, 201, JSON.stringify(paired.body));
    return { sessionId: created.data.sessionId, app: asApp(paired.data.token) };
  };

  /** Pretend the game started `minutes` ago (the API can't wait). */
  const playedFor = (sessionId, minutes) =>
    ctx.sql.query(
      `UPDATE recording_sessions SET startAt = DATE_SUB(startAt, INTERVAL ? SECOND)
       WHERE sessionId = ?`,
      [Math.round(minutes * 60), sessionId]
    );

  const videosOf = async (sessionId) =>
    (
      await ctx.sql.query(
        `SELECT sessionVideoId, captureId, camera, status FROM session_videos
         WHERE sessionId = ? ORDER BY captureId IS NULL DESC, camera`,
        [sessionId]
      )
    )[0];

  before(async () => {
    ctx = await startTestApp({
      env: { RATE_LIMIT_PAIR_POINTS: "1000", RATE_LIMIT_PAIR_HOURLY_POINTS: "1000" },
    });
    admin = await ctx.createStaff("Admin", { access: "write" });
    home.venueId = (await call("POST", "/admin/venues", { name: "Capture Courts" })).data.venueId;
    home.court1 = (
      await call("POST", "/admin/courts", {
        venueId: home.venueId,
        name: "Court 1",
        cameraRtspUrl: "rtsp://u:p@10.0.0.9:554/stream1",
      })
    ).data.courtId;
    home.court2 = (
      await call("POST", "/admin/courts", {
        venueId: home.venueId,
        name: "Court 2",
        cameraRtspUrl: "rtsp://u:p@10.0.0.10:554/stream1",
        camera2RtspUrl: "rtsp://u:p@10.0.0.11:554/stream1",
      })
    ).data.courtId;
    home.box = asDevice((await ctx.pairBox(admin.token, home.venueId, "Box")).data.token);
  });
  after(() => ctx?.stop());

  let game;

  it("refuses before the first minute, and refuses a save shorter than a minute", async () => {
    game = await startGame(home.court1);
    const early = await game.app("POST", "/app/session/captures", { seconds: 120 });
    assert.equal(early.status, 409);
    assert.equal(early.body.code, "TOO_EARLY");

    const short = await game.app("POST", "/app/session/captures", { seconds: 10 });
    assert.equal(short.status, 400);
    assert.equal((await videosOf(game.sessionId)).length, 0);
  });

  it("10 minutes in, 2 minutes saves 8:00 – 10:00 as its own video", async () => {
    await playedFor(game.sessionId, 10);
    const saved = await game.app("POST", "/app/session/captures", { seconds: 120 });
    assert.equal(saved.status, 201, JSON.stringify(saved.body));
    assert.ok(saved.data.captureId);

    const [capture] = saved.data.captures;
    assert.equal(capture.number, 1);
    assert.equal(capture.status, "Saving");
    assert.equal(capture.seconds, 120);
    assert.ok(Math.abs(capture.fromSeconds - 480) <= 2, `from ${capture.fromSeconds}`);
    assert.ok(Math.abs(capture.toSeconds - 600) <= 2, `to ${capture.toSeconds}`);
    assert.equal(capture.videos.length, 1, "one camera, one video");
    assert.equal(capture.videos[0].camera, 0);

    const rows = await videosOf(game.sessionId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].captureId, saved.data.captureId);
    assert.equal(rows[0].status, "Pending");
  });

  it("hands the box a copy job over the save's window, not the game's", async () => {
    const jobs = (await home.box("GET", "/device/jobs?wait=0")).data.jobs.filter(
      (job) => job.sessionId === game.sessionId
    );
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].type, "game");
    assert.equal(jobs[0].camera, 0);
    const span = jobs[0].windowEndMs - jobs[0].windowStartMs;
    assert.ok(Math.abs(span - 120_000) <= 2000, `window ${span} ms`);
    assert.ok(Math.abs(jobs[0].windowEndMs - Date.now()) < 60_000, "ends at the moment of Save");
  });

  it("answers a double tap with the same save, and queues a second one behind the first", async () => {
    const again = await game.app("POST", "/app/session/captures", { seconds: 120 });
    assert.equal(again.status, 200, "the same length within seconds is the same save");
    assert.equal(again.data.captures.length, 1);

    const long = await game.app("POST", "/app/session/captures", { seconds: 3600 });
    assert.equal(long.status, 201, JSON.stringify(long.body));
    const [first, second] = long.data.captures;
    assert.equal(first.status, "Saving");
    assert.equal(second.status, "Queued", "waits for the box to finish the first");
    assert.equal(second.number, 2);
    assert.equal(second.fromSeconds, 0, "never before the game started");
    assert.ok(Math.abs(second.toSeconds - 600) <= 2);
    assert.deepEqual(
      { used: long.data.capture.used, max: long.data.capture.maxPerGame },
      { used: 2, max: 5 }
    );
  });

  it("lists the saves on the game's page without IDs, and in Admin with them", async () => {
    const [[{ shareToken }]] = await ctx.sql.query(
      `SELECT shareToken FROM recording_sessions WHERE sessionId = ?`,
      [game.sessionId]
    );
    const page = await ctx.api("GET", `/public/sessions/${shareToken}`);
    assert.equal(page.status, 200, JSON.stringify(page.body));
    assert.equal(page.data.session.captures.length, 2);
    assert.equal(page.data.session.captures[0].captureId, undefined);
    assert.equal(page.data.session.captures[0].videos[0].label, "Video");
    assert.deepEqual(page.data.session.videos, [], "no whole-game video until End game");

    const detail = await call("GET", `/admin/sessions/${game.sessionId}`);
    assert.equal(detail.data.session.captures.length, 2);
    assert.ok(detail.data.session.captures[0].captureId);
    assert.equal(detail.data.session.videosTotal, 0, "saves aren't whole-game videos");
  });

  it("End game still makes the whole-game video, and the game settles without the saves", async () => {
    const stop = await game.app("POST", "/app/session/stop");
    assert.equal(stop.status, 200, JSON.stringify(stop.body));

    const rows = await videosOf(game.sessionId);
    const whole = rows.filter((r) => r.captureId === null);
    assert.equal(whole.length, 1, "one whole-game video next to the saves");
    assert.equal(rows.length, 3);

    // The whole video arrives; the saves are still being made
    await ctx.sql.query(
      `UPDATE session_videos SET status = 'Ready', videoPath = '/public/uploads/admin/clips/x/y.mp4',
              sizeBytes = 10 WHERE sessionVideoId = ?`,
      [whole[0].sessionVideoId]
    );
    const detail = await call("GET", `/admin/sessions/${game.sessionId}`);
    assert.equal(detail.data.session.status, "Ready", "settled on the whole game alone");
    assert.equal(detail.data.session.videosTotal, 1);
    assert.equal(detail.data.session.captures[0].status, "Saving");

    const late = await game.app("POST", "/app/session/captures", { seconds: 120 });
    assert.ok([401, 409].includes(late.status), `after the game: ${late.status}`);
  });

  it("makes one video per camera on a two-camera court", async () => {
    const two = await startGame(home.court2);
    await playedFor(two.sessionId, 5);
    // 15-second steps from a minute: 1 min 15 s
    const saved = await two.app("POST", "/app/session/captures", { seconds: 75 });
    assert.equal(saved.status, 201, JSON.stringify(saved.body));
    assert.equal(saved.data.captures[0].seconds, 75);
    assert.deepEqual(
      saved.data.captures[0].videos.map((video) => video.camera),
      [1, 2]
    );
    const device = await two.app("GET", "/app/session");
    assert.equal(device.data.capture.available, true);
    assert.equal(device.data.captures.length, 1);
    assert.ok(device.data.captures[0].captureId);
    await two.app("POST", "/app/session/stop"); // free the court for the next game
  });

  it("holds at most 5 saves; deleting one frees a slot", async () => {
    const { g, response } = await startTestCappedGame();
    assert.equal(response.status, 409);
    assert.equal(response.body.code, "TOO_MANY");

    const [[{ captureId }]] = await ctx.sql.query(
      `SELECT captureId FROM session_captures WHERE sessionId = ? LIMIT 1`,
      [g.sessionId]
    );
    const removed = await g.app("DELETE", `/app/session/captures/${captureId}`);
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
    assert.equal(removed.data.capture.used, 4);
    const again = await g.app("POST", "/app/session/captures", { seconds: 90 });
    assert.equal(again.status, 201, JSON.stringify(again.body));
    await g.app("POST", "/app/session/stop"); // free the court for the next game
  });

  it("New game can set how many saves it holds (here 2); out of range is refused", async () => {
    const tooMany = await call("POST", "/admin/sessions", { courtId: home.court1, maxCaptures: 21 });
    assert.equal(tooMany.status, 400);
    const none = await call("POST", "/admin/sessions", { courtId: home.court1, maxCaptures: 0 });
    assert.equal(none.status, 400);

    const g = await startGame(home.court1, { maxCaptures: 2 });
    await playedFor(g.sessionId, 10);
    const one = await call("GET", `/admin/sessions/${g.sessionId}`);
    assert.equal(one.data.session.maxCaptures, 2);
    const first = await g.app("POST", "/app/session/captures", { seconds: 60 });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const second = await g.app("POST", "/app/session/captures", { seconds: 120 });
    assert.equal(second.status, 201, JSON.stringify(second.body));
    assert.deepEqual(
      { max: second.data.capture.maxPerGame, used: second.data.capture.used },
      { max: 2, used: 2 }
    );
    const third = await g.app("POST", "/app/session/captures", { seconds: 180 });
    assert.equal(third.status, 409);
    assert.equal(third.body.code, "TOO_MANY");
    await g.app("POST", "/app/session/stop");
  });

  /** A game whose 5 saves are already used. */
  async function startTestCappedGame() {
    const g = await startGame(home.court1);
    await playedFor(g.sessionId, 20);
    const [[{ venueId }]] = await ctx.sql.query(
      `SELECT venueId FROM recording_sessions WHERE sessionId = ?`,
      [g.sessionId]
    );
    for (let i = 0; i < 5; i++) {
      await ctx.sql.query(
        `INSERT INTO session_captures
           (captureId, sessionId, venueId, startAt, endAt, seconds, status, dateCreated, dateUpdated)
         SELECT UUID(), ?, ?, startAt, startAt, 60, 'Active',
                DATE_SUB(NOW(), INTERVAL 1 HOUR), DATE_SUB(NOW(), INTERVAL 1 HOUR)
         FROM recording_sessions WHERE sessionId = ?`,
        [g.sessionId, venueId, g.sessionId]
      );
    }
    return { g, response: await g.app("POST", "/app/session/captures", { seconds: 60 }) };
  }

  it("deletes a save: gone from the lists and the box's jobs; a deleted or other game's save is a 404", async () => {
    const g = await startGame(home.court1);
    await playedFor(g.sessionId, 6);
    const saved = await g.app("POST", "/app/session/captures", { seconds: 60 });
    const { captureId } = saved.data;
    const other = await startGame(home.court2);

    const foreign = await other.app("DELETE", `/app/session/captures/${captureId}`);
    assert.equal(foreign.status, 404, "another game's save");

    const removed = await g.app("DELETE", `/app/session/captures/${captureId}`);
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
    assert.equal(removed.data.captures.length, 0);

    const [[capture]] = await ctx.sql.query(
      `SELECT status FROM session_captures WHERE captureId = ?`,
      [captureId]
    );
    assert.equal(capture.status, "Deleted", "soft delete");
    const [videos] = await ctx.sql.query(
      `SELECT status FROM session_videos WHERE captureId = ?`,
      [captureId]
    );
    assert.ok(videos.every((video) => video.status === "Deleted"));
    const jobs = (await home.box("GET", "/device/jobs?wait=0")).data.jobs;
    assert.ok(!jobs.some((job) => job.sessionId === g.sessionId), "the box no longer makes it");

    const twice = await g.app("DELETE", `/app/session/captures/${captureId}`);
    assert.equal(twice.status, 404, "a deleted save");
    const [[still]] = await ctx.sql.query(
      `SELECT status, dateUpdated FROM session_captures WHERE captureId = ?`,
      [captureId]
    );
    assert.equal(still.status, "Deleted");
  });
});
