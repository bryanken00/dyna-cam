// CR-008 — venue health and alerts. A recorder box reports its own health
// (disk, memory, clock, upload backlog) in the heartbeat; the venue-alerts job
// turns problems that last the grace period into Open alerts sent to Discord
// (and email once SendGrid is set up), and back to Resolved when they clear. The
// Dashboard shows today's figures, and the open problems to staff with the
// Venue alerts permission.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

const CAM = "rtsp://cam:Pass%40One1@192.168.1.50:554/stream1";
const SETTINGS = { graceMinutes: 0, diskFreePercent: 10, clockMs: 2000, backlogMinutes: 60 };
const HEALTHY = {
  diskFreeMb: 50_000,
  diskTotalMb: 100_000,
  memFreeMb: 1000,
  memTotalMb: 4000,
  load1: 0.5,
  cpus: 4,
  uptimeSeconds: 3600,
  clockOffsetMs: 12,
  pendingClips: 0,
  pendingGames: 0,
  oldestPendingSeconds: 0,
};

describe("venue health and alerts", () => {
  let ctx;
  let admin;
  let viewer;
  let venueId;
  let courtId;
  let deviceId;
  let box;
  let runVenueAlerts;
  let sent;
  let mailed;

  const call = (method, url, body, token = admin.token) => ctx.api(method, url, { token, body });
  const beat = (body) => box("POST", "/device/heartbeat", { body });
  const run = (opts = {}) =>
    runVenueAlerts(ctx.db, {
      settings: SETTINGS,
      discord: (message) => {
        sent.push(message);
        return Promise.resolve({ sent: true });
      },
      mail: (message) => {
        mailed.push(message);
        return Promise.resolve({ sent: true });
      },
      emailEnabled: false,
      ...opts,
    });
  const alerts = async () =>
    (await ctx.sql.query(`SELECT * FROM venue_alerts ORDER BY id`))[0];

  before(async () => {
    ctx = await startTestApp({
      env: { RATE_LIMIT_PAIR_POINTS: "1000", RATE_LIMIT_PAIR_HOURLY_POINTS: "1000" },
    });
    admin = await ctx.createStaff("Admin", { access: "write" });
    viewer = await ctx.createStaff("Viewer", { access: "read" });
    // The viewer sees the Dashboard but not the alerts (a per-user "none")
    await ctx.sql.query(
      `INSERT INTO user_permissions (userPermissionId, accountId, permissionId, accessLevel, dateCreated)
       SELECT UUID(), ?, permissionId, 'none', NOW() FROM permissions
       WHERE module = 'alerts' AND submodule IS NULL`,
      [viewer.accountId]
    );
    venueId = (await call("POST", "/admin/venues", { name: "Alert Courts" })).data.venueId;
    const court = await call("POST", "/admin/courts", {
      venueId,
      name: "Court 1",
      cameraRtspUrl: CAM,
    });
    courtId = court.data.courtId;
    const paired = await ctx.pairBox(admin.token, venueId, "Venue Box");
    const token = paired.data.token;
    box = (method, url, options = {}) =>
      ctx.api(method, url, { ...options, headers: { Authorization: `Device ${token}` } });
    ({ runVenueAlerts } = await ctx.importFromBack("server/src/jobs/venueAlerts.js"));
  });
  after(() => ctx?.stop());

  it("stores the box's health, and still takes a heartbeat without it", async () => {
    const res = await beat({ cameras: [{ courtId, status: "ok" }], system: HEALTHY });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const [[row]] = await ctx.sql.query(
      `SELECT deviceId, lastStatus FROM devices WHERE venueId = ?`,
      [venueId]
    );
    deviceId = row.deviceId;
    const status = typeof row.lastStatus === "string" ? JSON.parse(row.lastStatus) : row.lastStatus;
    assert.equal(status.system.diskFreeMb, 50_000);

    const old = await beat({ cameras: [{ courtId, status: "ok" }] });
    assert.equal(old.status, 200, "an older box (no system) keeps working");
    const bad = await beat({ cameras: [], system: { diskFreeMb: -5 } });
    assert.equal(bad.status, 400);
  });

  it("finds nothing wrong with a healthy box", async () => {
    sent = [];
    mailed = [];
    await beat({ cameras: [{ courtId, status: "ok" }], system: HEALTHY });
    const tally = await run();
    assert.equal(tally.added, 0);
    assert.equal((await alerts()).length, 0);
    assert.equal(sent.length, 0);
  });

  it("opens a camera problem after the grace period and sends it once", async () => {
    sent = [];
    await beat({
      cameras: [{ courtId, camera: 1, status: "error", message: "Camera not reachable" }],
      system: HEALTHY,
    });
    let tally = await run();
    assert.equal(tally.added, 1);
    let [row] = await alerts();
    assert.equal(row.status, "Pending");
    assert.equal(row.kind, "CAMERA_DOWN");
    assert.equal(sent.length, 0, "nothing is sent during the grace period");

    tally = await run();
    assert.equal(tally.opened, 1);
    assert.equal(tally.discord, true);
    [row] = await alerts();
    assert.equal(row.status, "Open");
    assert.ok(row.notifiedAt);
    assert.equal(sent.length, 1);
    assert.match(sent[0].content, /1 new problem/);
    assert.match(sent[0].embeds[0].title, /Camera not recording · Alert Courts/);
    assert.match(sent[0].embeds[0].description, /Court 1 · Cam 1 is not recording: Camera not reachable/);

    await run();
    assert.equal(sent.length, 1, "an open problem isn't sent again");
    assert.equal((await alerts()).length, 1);
  });

  it("keeps a camera problem open while its box is offline, and opens a box problem", async () => {
    sent = [];
    await ctx.sql.query(
      `UPDATE devices SET lastSeenAt = DATE_SUB(lastSeenAt, INTERVAL 10 MINUTE) WHERE deviceId = ?`,
      [deviceId]
    );
    await run();
    await run();
    const rows = await alerts();
    const camera = rows.find((row) => row.kind === "CAMERA_DOWN");
    const offline = rows.find((row) => row.kind === "BOX_OFFLINE");
    assert.equal(camera.status, "Open", "unknown while offline — not resolved");
    assert.equal(offline.status, "Open");
    assert.equal(sent.length, 1);
    assert.match(sent[0].embeds[0].title, /Recorder box offline/);
  });

  it("resolves both when the box is back and the camera records, and says so", async () => {
    sent = [];
    await beat({ cameras: [{ courtId, status: "ok" }], system: HEALTHY });
    const tally = await run();
    assert.equal(tally.resolved, 2);
    const rows = await alerts();
    assert.ok(rows.every((row) => row.status === "Resolved" && row.resolvedNotifiedAt));
    assert.equal(sent.length, 1);
    assert.match(sent[0].content, /2 fixed/);
  });

  it("clears a problem that goes away inside the grace period without telling anyone", async () => {
    sent = [];
    await beat({ cameras: [{ courtId, status: "ok" }], system: { ...HEALTHY, clockOffsetMs: 9000 } });
    await run({ settings: { ...SETTINGS, graceMinutes: 30 } });
    await beat({ cameras: [{ courtId, status: "ok" }], system: HEALTHY });
    await run({ settings: { ...SETTINGS, graceMinutes: 30 } });
    const clock = (await alerts()).find((row) => row.kind === "CLOCK_OFF");
    assert.equal(clock.status, "Cleared");
    assert.equal(sent.length, 0);
  });

  it("reports disk, clock and backlog problems from the box's health", async () => {
    sent = [];
    await beat({
      cameras: [{ courtId, status: "ok" }],
      system: {
        ...HEALTHY,
        diskFreeMb: 4000,
        clockOffsetMs: -3500,
        pendingClips: 2,
        pendingGames: 1,
        oldestPendingSeconds: 2 * 3600,
      },
    });
    await run();
    await run();
    const open = (await alerts()).filter((row) => row.status === "Open").map((row) => row.kind);
    assert.deepEqual(open.sort(), ["CLOCK_OFF", "DISK_LOW", "UPLOAD_BACKLOG"]);
    const text = sent[0].embeds.map((embed) => embed.description).join("\n");
    assert.match(text, /4% disk left/);
    assert.match(text, /3\.5s ahead of the server/);
    assert.match(text, /3 clip\(s\)\/game video\(s\) unsent, the oldest for 2 h 0 min/);
  });

  it("emails staff with Venue alerts once email is set up — never the ones without", async () => {
    sent = [];
    mailed = [];
    await beat({ cameras: [{ courtId, status: "ok" }], system: HEALTHY });
    await run({ emailEnabled: true });
    const to = mailed.map((message) => message.to);
    assert.ok(to.includes(admin.email), "staff with the permission");
    assert.ok(to.includes((await ctx.owner()).email), "the Owner");
    assert.ok(!to.includes(viewer.email), "a per-user 'none' gets nothing");
    assert.match(mailed[0].subject, /All clear at Alert Courts/);
    assert.match(mailed[0].html, /Fixed/);
  });

  it("leaves a problem unmarked when no channel delivered it", async () => {
    await beat({ cameras: [{ courtId, status: "error", message: "x" }], system: HEALTHY });
    await run();
    const tally = await run({
      discord: () => Promise.resolve({ sent: false, reason: "not configured" }),
      mail: () => Promise.resolve({ sent: false }),
      emailEnabled: true,
    });
    assert.equal(tally.opened, 1);
    assert.equal(tally.discord, false);
    assert.equal(tally.emailed, 0);
    const row = (await alerts()).find((r) => r.kind === "CAMERA_DOWN" && r.status === "Open");
    assert.equal(row.notifiedAt, null, "not marked as sent");
  });

  describe("Dashboard", () => {
    it("shows today's figures to anyone with the Dashboard", async () => {
      const res = await call("GET", "/admin/dashboard/venues", undefined, viewer.token);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const { venues } = res.data;
      assert.deepEqual(venues.boxes, { online: 1, total: 1 });
      assert.deepEqual(venues.cameras, { ok: 0, total: 1 });
      assert.equal(typeof venues.cashToday, "number");
      assert.equal(typeof venues.recordingNow, "number");
    });

    it("shows each court on the court board: cameras, the game on court, replays", async () => {
      const empty = (await call("GET", "/admin/dashboard/venues")).data.venues.courts;
      assert.deepEqual(empty, [
        {
          courtId,
          name: "Court 1",
          venueId,
          venueName: "Alert Courts",
          cameras: [{ camera: 1, status: "error" }],
          game: null,
          replaysToday: 0,
        },
      ]);

      const game = await call("POST", "/admin/sessions", { courtId, playerName: "Juan Cruz" });
      assert.equal(game.status, 201, JSON.stringify(game.body));
      const res = await call("GET", "/admin/dashboard/venues", undefined, viewer.token);
      const [court] = res.data.venues.courts;
      assert.deepEqual(court.game, { state: "waiting" });
      assert.ok(!JSON.stringify(res.body).includes("Juan Cruz"), "no player names on the board");
      assert.ok(!JSON.stringify(res.body).includes("Pass%40One1"));

      await ctx.sql.query(`UPDATE devices SET lastSeenAt = '2000-01-01 00:00:00' WHERE deviceId = ?`, [
        deviceId,
      ]);
      const offline = await call("GET", "/admin/dashboard/venues");
      assert.equal(offline.data.venues.courts[0].cameras[0].status, "offline");
      await beat({ cameras: [{ courtId, status: "error", message: "x" }], system: HEALTHY });
    });

    it("lists open problems and box health only with Venue alerts", async () => {
      const denied = await call("GET", "/admin/dashboard/alerts", undefined, viewer.token);
      assert.equal(denied.status, 403);

      const res = await call("GET", "/admin/dashboard/alerts");
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const camera = res.data.problems.find((p) => p.kind === "CAMERA_DOWN");
      assert.equal(camera.label, "Camera not recording");
      assert.equal(camera.venueName, "Alert Courts");
      const [shown] = res.data.boxes;
      assert.equal(shown.name, "Venue Box");
      assert.equal(shown.online, true);
      assert.equal(shown.system.diskTotalMb, 100_000);
      assert.deepEqual(shown.cameras[0], {
        courtId,
        courtName: "Court 1",
        camera: 1,
        status: "error",
        message: "x",
      });
      assert.ok(!JSON.stringify(res.body).includes("Pass%40One1"));
    });
  });
});

describe("Discord webhook", () => {
  let postDiscord;
  let discordWebhookUrl;
  const URL_OK = "https://discord.com/api/webhooks/123456/abc-DEF_ghi";

  before(async () => {
    ({ postDiscord, discordWebhookUrl } = await import("../server/src/lib/discord/webhook.js"));
  });

  it("is off without a URL, and refuses one that isn't a Discord webhook", () => {
    const before = process.env.ALERT_DISCORD_WEBHOOK_URL;
    process.env.ALERT_DISCORD_WEBHOOK_URL = "";
    assert.equal(discordWebhookUrl(), null);
    process.env.ALERT_DISCORD_WEBHOOK_URL = "https://evil.example/api/webhooks/1/x";
    assert.equal(discordWebhookUrl(), null);
    process.env.ALERT_DISCORD_WEBHOOK_URL = URL_OK;
    assert.equal(discordWebhookUrl(), URL_OK);
    process.env.ALERT_DISCORD_WEBHOOK_URL = before ?? "";
  });

  it("posts with mentions off and Discord's length limits", async () => {
    const calls = [];
    const result = await postDiscord(
      {
        content: "@everyone 1 new problem",
        embeds: Array.from({ length: 12 }, (_, i) => ({ title: `t${i}`, description: "d" })),
      },
      {
        url: URL_OK,
        fetchImpl: (url, init) => {
          calls.push({ url, body: JSON.parse(init.body) });
          return Promise.resolve({ ok: true, status: 204 });
        },
      }
    );
    assert.deepEqual(result, { sent: true });
    assert.deepEqual(calls[0].body.allowed_mentions, { parse: [] });
    assert.equal(calls[0].body.embeds.length, 10);
  });

  it("retries once after a 429, and reports a refusal", async () => {
    let tries = 0;
    const result = await postDiscord(
      { content: "x" },
      {
        url: URL_OK,
        fetchImpl: () => {
          tries += 1;
          return Promise.resolve(
            tries === 1
              ? { ok: false, status: 429, json: () => Promise.resolve({ retry_after: 0.01 }) }
              : { ok: true, status: 204 }
          );
        },
      }
    );
    assert.equal(result.sent, true);
    assert.equal(tries, 2);

    const refused = await postDiscord(
      { content: "x" },
      { url: URL_OK, fetchImpl: () => Promise.resolve({ ok: false, status: 404 }) }
    );
    assert.deepEqual(refused, { sent: false, reason: "HTTP 404" });
    assert.deepEqual(await postDiscord({ content: "x" }, { url: null }), {
      sent: false,
      reason: "not configured",
    });
  });
});
