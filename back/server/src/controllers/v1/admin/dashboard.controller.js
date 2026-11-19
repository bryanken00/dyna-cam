import express from "express";
import { catchAsync } from "../../../utils/catchAsync.js";
import { checkPermission } from "../../../middlewares/checkPermission.middleware.js";
import { getCurrentTimestampLocal, getTodayDateLocal, moment } from "../../../utils/dateUtils.js";
import { ALERT_LABELS, boxHealth } from "../../../utils/venueHealth.js";

const router = express.Router();

const TZ = process.env.TIMEZONE || "Asia/Manila";
const SERIES_DAYS = 14;

/**
 * Build a gap-free daily series for the last `days` days (Manila dates).
 * Rows come back as [{ day: 'YYYY-MM-DD', count }] and may skip empty days.
 */
const fillDailySeries = (rows, days = SERIES_DAYS) => {
  const counts = new Map(rows.map((r) => [String(r.day), Number(r.count)]));
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = moment().tz(TZ).subtract(i, "days").format("YYYY-MM-DD");
    series.push({ date, count: counts.get(date) || 0 });
  }
  return series;
};

/**
 * GET /stats
 * Dashboard metrics.
 */
router.get(
  "/stats",
  checkPermission("dashboard", null, "read"),
  catchAsync(async (req, res) => {
    const since = moment().tz(TZ).subtract(SERIES_DAYS - 1, "days").format("YYYY-MM-DD 00:00:00");

    const [
      userCounts,
      roleCount,
      auditCount,
      userSeries,
      activitySeries,
      recentActivity,
    ] = await Promise.all([
      // Totals + active, excluding the system-managed Owner
      req.db.query(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN u.status = 'Active' THEN 1 ELSE 0 END) AS active
         FROM users u
         LEFT JOIN roles r ON r.roleId = u.roleId
         WHERE u.status != 'Deleted' AND (r.roleName IS NULL OR r.roleName != 'Owner')`
      ),
      req.db.query(
        `SELECT COUNT(*) AS total FROM roles
         WHERE status != 'Deleted' AND roleName != 'Owner'`
      ),
      req.db.query(`SELECT COUNT(*) AS total FROM audit_trail WHERE dateCreated >= ?`, [since]),
      req.db.query(
        `SELECT DATE(dateCreated) AS day, COUNT(*) AS count
         FROM users
         WHERE status != 'Deleted' AND dateCreated >= ?
         GROUP BY DATE(dateCreated)`,
        [since]
      ),
      req.db.query(
        `SELECT DATE(dateCreated) AS day, COUNT(*) AS count
         FROM audit_trail
         WHERE dateCreated >= ?
         GROUP BY DATE(dateCreated)`,
        [since]
      ),
      req.db.query(
        `SELECT a.auditId, a.action, a.module, a.description, a.dateCreated,
                u.firstName, u.lastName
         FROM audit_trail a
         LEFT JOIN users u ON u.accountId = a.accountId
         ORDER BY a.dateCreated DESC
         LIMIT 6`
      ),
    ]);

    return res.sendSuccess("Dashboard stats retrieved successfully", {
      stats: {
        totalUsers: Number(userCounts[0]?.total || 0),
        activeUsers: Number(userCounts[0]?.active || 0),
        totalRoles: Number(roleCount[0]?.total || 0),
        auditEvents: Number(auditCount[0]?.total || 0),
        seriesDays: SERIES_DAYS,
      },
      userGrowth: fillDailySeries(userSeries),
      activityByDay: fillDailySeries(activitySeries),
      recentActivity,
    });
  })
);

/** Cameras each online box reports for courts still in use: { ok, total }. */
const cameraCounts = (boxes) => {
  let ok = 0;
  let total = 0;
  for (const box of boxes) {
    for (const entry of Array.isArray(box.status.cameras) ? box.status.cameras : []) {
      if (!box.courts.has(entry?.courtId)) continue;
      total += 1;
      if (box.online && entry.status === "ok") ok += 1;
    }
  }
  return { ok, total };
};

/** Seconds from `from` to `to` (stored Manila timestamps); null without both. */
const secondsBetween = (from, to) =>
  from && to
    ? moment.tz(to, "YYYY-MM-DD HH:mm:ss", TZ).diff(moment.tz(from, "YYYY-MM-DD HH:mm:ss", TZ), "seconds")
    : null;

/**
 * Every court in use, venue by venue, as the Dashboard's court board shows it:
 * each configured camera's state (from its recorder box's heartbeat), the game
 * on court now (or waiting for its device, or the next one today) and today's
 * replays. No player names — the Sessions page has those.
 */
const courtBoard = async (db, boxes, { now, dayStart, dayEnd }) => {
  const [courts, games, replays] = await Promise.all([
    db.query(
      `SELECT c.courtId, c.name, c.venueId, v.name AS venueName,
              c.cameraRtspUrl IS NOT NULL AS hasCamera1,
              c.camera2RtspUrl IS NOT NULL AS hasCamera2
       FROM courts c
       JOIN venues v ON v.venueId = c.venueId AND v.status != 'Deleted'
       WHERE c.status = 'Active'`
    ),
    db.query(
      `SELECT courtId, status, startAt, endAt, openEnded
       FROM recording_sessions
       WHERE status IN ('Recording', 'Waiting')
          OR (status = 'Scheduled' AND startAt BETWEEN ? AND ?)
       ORDER BY startAt`,
      [now, dayEnd]
    ),
    db.query(
      `SELECT courtId, COUNT(*) AS total FROM clips
       WHERE sessionId IS NULL AND status != 'Deleted' AND dateCreated BETWEEN ? AND ?
       GROUP BY courtId`,
      [dayStart, dayEnd]
    ),
  ]);

  const cameraState = new Map();
  for (const box of boxes) {
    for (const entry of Array.isArray(box.status.cameras) ? box.status.cameras : []) {
      const key = `${entry?.courtId}:${entry?.camera === 2 ? 2 : 1}`;
      // An online box's report wins over an offline one's
      if (box.online || !cameraState.has(key)) {
        cameraState.set(key, box.online ? entry.status : "offline");
      }
    }
  }
  const replayCount = new Map(replays.map((row) => [row.courtId, Number(row.total)]));
  const gamesByCourt = new Map();
  for (const game of games) {
    if (!gamesByCourt.has(game.courtId)) gamesByCourt.set(game.courtId, []);
    gamesByCourt.get(game.courtId).push(game);
  }

  return courts
    .map((court) => {
      const courtGames = gamesByCourt.get(court.courtId) || [];
      const playing = courtGames.find((game) => game.status === "Recording");
      const waiting = courtGames.find((game) => game.status === "Waiting");
      const next = courtGames.find((game) => game.status === "Scheduled");
      let game = null;
      if (playing) {
        game = {
          state: "playing",
          openEnded: Boolean(playing.openEnded),
          elapsedSeconds: Math.max(0, secondsBetween(playing.startAt, now) ?? 0),
          remainingSeconds: playing.openEnded
            ? null
            : Math.max(0, secondsBetween(now, playing.endAt) ?? 0),
        };
      } else if (waiting) {
        game = { state: "waiting" };
      } else if (next) {
        game = { state: "next", startAt: next.startAt, startsInSeconds: secondsBetween(now, next.startAt) };
      }
      const cameras = [];
      if (court.hasCamera1) cameras.push(1);
      if (court.hasCamera2) cameras.push(2);
      return {
        courtId: court.courtId,
        name: court.name,
        venueId: court.venueId,
        venueName: court.venueName,
        cameras: cameras.map((camera) => ({
          camera,
          status: cameraState.get(`${court.courtId}:${camera}`) || "unknown",
        })),
        game,
        replaysToday: replayCount.get(court.courtId) || 0,
      };
    })
    .sort(
      (a, b) =>
        a.venueName.localeCompare(b.venueName) ||
        a.name.localeCompare(b.name, undefined, { numeric: true })
    );
};

/**
 * GET /venues
 * CR-008: today at the venues — games recording now and today, replay clips,
 * cash taken, how many recorder boxes and cameras are up, and the court board.
 */
router.get(
  "/venues",
  checkPermission("dashboard", null, "read"),
  catchAsync(async (req, res) => {
    const today = getTodayDateLocal();
    const now = getCurrentTimestampLocal();
    const dayStart = `${today} 00:00:00`;
    const dayEnd = `${today} 23:59:59`;

    const [sessions, clips, cash, boxes] = await Promise.all([
      req.db.query(
        `SELECT
           SUM(CASE WHEN status = 'Recording' THEN 1 ELSE 0 END) AS recording,
           SUM(CASE WHEN status NOT IN ('Cancelled') AND startAt BETWEEN ? AND ? THEN 1 ELSE 0 END) AS today
         FROM recording_sessions
         WHERE status = 'Recording' OR startAt BETWEEN ? AND ?`,
        [dayStart, dayEnd, dayStart, dayEnd]
      ),
      req.db.query(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status = 'Ready' THEN 1 ELSE 0 END) AS ready
         FROM clips
         WHERE sessionId IS NULL AND status != 'Deleted' AND dateCreated BETWEEN ? AND ?`,
        [dayStart, dayEnd]
      ),
      req.db.query(
        `SELECT COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS count
         FROM payments WHERE status = 'Paid' AND paidAt BETWEEN ? AND ?`,
        [dayStart, dayEnd]
      ),
      boxHealth(req.db),
    ]);

    const courts = await courtBoard(req.db, boxes, { now, dayStart, dayEnd });

    return res.sendSuccess("Venue figures retrieved successfully", {
      venues: {
        date: today,
        recordingNow: Number(sessions[0]?.recording || 0),
        gamesToday: Number(sessions[0]?.today || 0),
        clipsToday: Number(clips[0]?.total || 0),
        clipsReadyToday: Number(clips[0]?.ready || 0),
        cashToday: Number(cash[0]?.amount || 0),
        paymentsToday: Number(cash[0]?.count || 0),
        boxes: { online: boxes.filter((box) => box.online).length, total: boxes.length },
        cameras: cameraCounts(boxes),
        courts,
      },
    });
  })
);

/**
 * GET /alerts
 * CR-008: open problems (and ones still inside their grace period) and every
 * recorder box with its health — for staff with the Venue alerts permission.
 */
router.get(
  "/alerts",
  checkPermission("alerts", null, "read"),
  catchAsync(async (req, res) => {
    const [rows, boxes] = await Promise.all([
      req.db.query(
        `SELECT a.alertId, a.kind, a.status, a.message, a.firstSeenAt, a.openedAt,
                a.courtId, a.camera, v.name AS venueName
         FROM venue_alerts a
         JOIN venues v ON v.venueId = a.venueId
         WHERE a.status IN ('Pending', 'Open')
         ORDER BY a.status = 'Open' DESC, a.firstSeenAt ASC
         LIMIT 200`
      ),
      boxHealth(req.db),
    ]);

    const problems = rows.map((row) => ({ ...row, label: ALERT_LABELS[row.kind] || row.kind }));
    const boxList = boxes.map((box) => {
      const system = box.status.system || null;
      return {
        deviceId: box.deviceId,
        name: box.name,
        venueName: box.venueName,
        online: box.online,
        lastSeenAt: box.lastSeenAt,
        agentVersion: box.agentVersion,
        system: system && {
          diskFreeMb: system.diskFreeMb ?? null,
          diskTotalMb: system.diskTotalMb ?? null,
          memFreeMb: system.memFreeMb ?? null,
          memTotalMb: system.memTotalMb ?? null,
          load1: system.load1 ?? null,
          cpus: system.cpus ?? null,
          uptimeSeconds: system.uptimeSeconds ?? null,
          clockOffsetMs: system.clockOffsetMs ?? null,
          pendingClips: system.pendingClips ?? 0,
          pendingGames: system.pendingGames ?? 0,
          oldestPendingSeconds: system.oldestPendingSeconds ?? 0,
        },
        cameras: (Array.isArray(box.status.cameras) ? box.status.cameras : [])
          .filter((entry) => box.courts.has(entry?.courtId))
          .map((entry) => ({
            courtId: entry.courtId,
            courtName: box.courts.get(entry.courtId),
            camera: entry.camera === 2 ? 2 : 1,
            status: box.online ? entry.status : "unknown",
            message: entry.message || null,
          })),
      };
    });

    return res.sendSuccess("Venue alerts retrieved successfully", {
      problems,
      boxes: boxList,
    });
  })
);

export default router;
