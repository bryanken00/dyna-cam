import express from "express";
import { catchAsync, validateQuery } from "../../../utils/catchAsync.js";
import { dashboardInsightsQuerySchema } from "../../../validators/dashboard.validator.js";
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

const FORMAT = "YYYY-MM-DD HH:mm:ss";
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** CR-023: a game that recorded (not waiting, booked ahead or cancelled). */
const PLAYED = `status IN ('Recording', 'Processing', 'Ready', 'Failed')`;
/** Seconds a game recorded so far (an open game's endAt is a placeholder ahead of now). */
const RECORDED_SECONDS = `GREATEST(0, TIMESTAMPDIFF(SECOND, startAt, LEAST(endAt, ?)))`;

/** The busiest entry of [{ ..., games }], or null when nothing was played. */
const busiest = (rows) =>
  rows.reduce((best, row) => (row.games > (best?.games ?? 0) ? row : best), null);

/**
 * GET /insights?days=7|30 — CR-023: how the courts were used over the last
 * 7 or 30 days (Manila dates, today included), all venues together:
 * games played (and the period before), average game length, recorded time
 * per day, cash collected, games per day / by start hour / by weekday — and
 * every finished game still unpaid, whatever its date.
 */
router.get(
  "/insights",
  checkPermission("dashboard", null, "read"),
  validateQuery(dashboardInsightsQuerySchema),
  catchAsync(async (req, res) => {
    const days = req.query.days;
    const nowM = moment().tz(TZ);
    const now = nowM.format(FORMAT);
    const fromM = nowM.clone().startOf("day").subtract(days - 1, "days");
    const from = fromM.format(FORMAT);
    const prevFrom = fromM.clone().subtract(days, "days").format(FORMAT);

    const [perDayRows, hourRows, weekdayRows, previous, unpaid, cash] = await Promise.all([
      req.db.query(
        `SELECT DATE_FORMAT(startAt, '%Y-%m-%d') AS day, COUNT(*) AS games,
                COALESCE(SUM(${RECORDED_SECONDS}), 0) AS seconds
         FROM recording_sessions
         WHERE ${PLAYED} AND startAt >= ? AND startAt <= ?
         GROUP BY day`,
        [now, from, now]
      ),
      req.db.query(
        `SELECT HOUR(startAt) AS hour, COUNT(*) AS games
         FROM recording_sessions
         WHERE ${PLAYED} AND startAt >= ? AND startAt <= ?
         GROUP BY hour`,
        [from, now]
      ),
      req.db.query(
        `SELECT WEEKDAY(startAt) AS weekday, COUNT(*) AS games
         FROM recording_sessions
         WHERE ${PLAYED} AND startAt >= ? AND startAt <= ?
         GROUP BY weekday`,
        [from, now]
      ),
      req.db.query(
        `SELECT COUNT(*) AS games FROM recording_sessions
         WHERE ${PLAYED} AND startAt >= ? AND startAt < ?`,
        [prevFrom, from]
      ),
      // Finished games still waiting for their payment at the desk — any date
      req.db.query(
        `SELECT COUNT(*) AS games, MIN(endAt) AS oldestEndAt FROM recording_sessions
         WHERE paymentStatus = 'Unpaid' AND status IN ('Processing', 'Ready')`
      ),
      req.db.query(
        `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS payments,
                SUM(sessionId IS NOT NULL) AS gamePayments,
                COALESCE(SUM(CASE WHEN sessionId IS NOT NULL THEN amount END), 0) AS gameTotal
         FROM payments
         WHERE status = 'Paid' AND paidAt >= ? AND paidAt <= ?`,
        [from, now]
      ),
    ]);

    const byDay = new Map(perDayRows.map((row) => [row.day, row]));
    const perDay = [];
    for (let i = 0; i < days; i += 1) {
      const date = fromM.clone().add(i, "days").format("YYYY-MM-DD");
      const row = byDay.get(date);
      perDay.push({
        date,
        games: Number(row?.games || 0),
        recordedSeconds: Number(row?.seconds || 0),
      });
    }
    const gamesPlayed = perDay.reduce((sum, d) => sum + d.games, 0);
    const totalRecordedSeconds = perDay.reduce((sum, d) => sum + d.recordedSeconds, 0);

    const hours = new Map(hourRows.map((row) => [Number(row.hour), Number(row.games)]));
    const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, games: hours.get(hour) || 0 }));
    const weekdays = new Map(weekdayRows.map((row) => [Number(row.weekday), Number(row.games)]));
    const byWeekday = WEEKDAYS.map((label, weekday) => ({
      weekday,
      label,
      games: weekdays.get(weekday) || 0,
    }));

    const gamePayments = Number(cash[0]?.gamePayments || 0);
    return res.sendSuccess("Dashboard insights", {
      insights: {
        days,
        from,
        to: now,
        gamesPlayed,
        gamesPrevious: Number(previous[0]?.games || 0),
        totalRecordedSeconds,
        averageGameSeconds: gamesPlayed ? Math.round(totalRecordedSeconds / gamesPlayed) : 0,
        recordedPerDaySeconds: Math.round(totalRecordedSeconds / days),
        unpaidGames: {
          count: Number(unpaid[0]?.games || 0),
          oldestEndAt: unpaid[0]?.oldestEndAt || null,
        },
        cash: {
          total: Number(cash[0]?.total || 0),
          payments: Number(cash[0]?.payments || 0),
          gamePayments,
          averagePerGame: gamePayments
            ? Math.round((Number(cash[0]?.gameTotal || 0) / gamePayments) * 100) / 100
            : 0,
        },
        perDay,
        byHour,
        busiestHour: busiest(byHour),
        byWeekday,
        busiestWeekday: busiest(byWeekday),
      },
    });
  })
);

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
