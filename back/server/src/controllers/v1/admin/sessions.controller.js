import express from "express";
import { catchAsync, validateBody, validateQuery } from "../../../utils/catchAsync.js";
import { getCurrentTimestampLocal, moment } from "../../../utils/dateUtils.js";
import { checkPermission } from "../../../middlewares/checkPermission.middleware.js";
import { randomToken } from "../../../utils/crypto/tokens.js";
import { sessionShareUrl, toEpochMs } from "../../../utils/clips.js";
import { signedDownloadUrl, signUploadUrl } from "../../../utils/file/signedUrl.js";
import { noIdempotencyCache } from "../../../middlewares/idempotency.middleware.js";
import { createPairingCode, PAIRING_CODE_TTL_MINUTES } from "../../../utils/pairing.js";
import { createSessionPairingCodeSchema } from "../../../validators/pairing.validator.js";
import { clearStream, describeStream, FORGET_STREAM_SQL } from "../../../utils/sessionStreams.js";
import {
  endSessionNow,
  materializeSessionParts,
  partCount,
  SESSION_MAX_DAYS_AHEAD,
  settleSessions,
} from "../../../utils/sessions.js";
import {
  createSessionSchema,
  listSessionsQuerySchema,
} from "../../../validators/sessions.validator.js";

/**
 * Recording sessions — a court booked for a whole time window (PLAN-001
 * Phase 3). Permission: clips (a session's footage is delivered as clips).
 * See utils/sessions.js for how a session becomes 5-minute parts. Phones/tablets
 * are paired to one session here (PLAN-002 Phase E, /:sessionId/pairing-codes)
 * and see it live through /api/v1/app (utils/sessionDevices.js).
 */
const router = express.Router();

const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";
const FORMAT = "YYYY-MM-DD HH:mm:ss";

const SESSION_SELECT = `
  SELECT s.sessionId, s.venueId, v.name AS venueName, s.courtId, c.name AS courtName,
         s.startAt, s.endAt, s.playerName, s.phone, s.shareToken, s.status, s.failureReason,
         s.dateCreated, s.dateUpdated,
         COALESCE(CONCAT(u.firstName, ' ', u.lastName), CONCAT(pa.name, ' (phone)')) AS startedBy,
         (SELECT COUNT(*) FROM clips p WHERE p.sessionId = s.sessionId AND p.status = 'Ready')
           AS partsReady,
         (SELECT COUNT(*) FROM paired_apps d WHERE d.sessionId = s.sessionId AND d.status = 'Active')
           AS devicesCount
  FROM recording_sessions s
  JOIN venues v ON v.venueId = s.venueId
  JOIN courts c ON c.courtId = s.courtId
  LEFT JOIN users u ON u.accountId = s.createdByAccountId
  LEFT JOIN paired_apps pa ON pa.pairedAppId = s.pairedAppId`;

const toSession = (row) => {
  const { shareToken, ...session } = row;
  return {
    ...session,
    durationMinutes: moment(row.endAt).diff(moment(row.startAt), "minutes"),
    partsTotal: partCount(row.startAt, row.endAt),
    partsReady: Number(row.partsReady || 0),
    devicesCount: Number(row.devicesCount || 0),
    shareUrl: sessionShareUrl(shareToken),
  };
};

/**
 * GET /
 */
router.get(
  "/",
  checkPermission("clips", null, "read"),
  validateQuery(listSessionsQuerySchema),
  catchAsync(async (req, res) => {
    // Bring statuses up to date before showing them
    await materializeSessionParts(req.db);
    await settleSessions(req.db);

    const { page = 1, pageSize = 20, venueId, courtId, status, search = "", sortOrder } = req.query;
    const offset = (page - 1) * pageSize;
    const params = [];
    let whereClause = "WHERE 1 = 1";
    if (status) {
      whereClause += " AND s.status = ?";
      params.push(status);
    }
    if (venueId) {
      whereClause += " AND s.venueId = ?";
      params.push(venueId);
    }
    if (courtId) {
      whereClause += " AND s.courtId = ?";
      params.push(courtId);
    }
    if (search) {
      whereClause += " AND (s.playerName LIKE ? OR c.name LIKE ? OR v.name LIKE ?)";
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    const safeSortOrder = sortOrder === "ASC" ? "ASC" : "DESC";

    const [countRows, sessions] = await Promise.all([
      req.db.query(
        `SELECT COUNT(*) AS total FROM recording_sessions s
         JOIN venues v ON v.venueId = s.venueId
         JOIN courts c ON c.courtId = s.courtId
         ${whereClause}`,
        params
      ),
      req.db.query(
        `${SESSION_SELECT}
         ${whereClause}
         ORDER BY s.startAt ${safeSortOrder}
         LIMIT ? OFFSET ?`,
        [...params, Number(pageSize), Number(offset)]
      ),
    ]);
    const total = countRows[0]?.total || 0;

    return res.sendSuccess("Sessions retrieved successfully", {
      sessions: sessions.map(toSession),
      pagination: {
        page: Number(page),
        pageSize: Number(pageSize),
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  })
);

/**
 * GET /:sessionId — with its parts
 */
router.get(
  "/:sessionId",
  checkPermission("clips", null, "read"),
  catchAsync(async (req, res) => {
    await materializeSessionParts(req.db);
    await settleSessions(req.db, req.params.sessionId);

    const rows = await req.db.query(`${SESSION_SELECT} WHERE s.sessionId = ? LIMIT 1`, [
      req.params.sessionId,
    ]);
    if (rows.length === 0) {
      return res.sendError("Session not found", 404);
    }

    const parts = await req.db.query(
      `SELECT clipId, partIndex, windowStartAt, windowEndAt, durationSeconds, status,
              failureReason, videoPath, thumbnailPath, expiresAt
       FROM clips
       WHERE sessionId = ? AND status != 'Deleted'
       ORDER BY partIndex ASC`,
      [req.params.sessionId]
    );

    const [devices, pairingCodes] = await Promise.all([
      req.db.query(
        `SELECT pairedAppId, name, platform, appVersion, lastSeenAt, status
         FROM paired_apps
         WHERE sessionId = ? AND status != 'Deleted'
         ORDER BY dateCreated ASC`,
        [req.params.sessionId]
      ),
      req.db.query(
        `SELECT pairingCodeId, name, expiresAt
         FROM pairing_codes
         WHERE sessionId = ? AND kind = 'APP' AND status = 'Active' AND expiresAt > ?
         ORDER BY dateCreated DESC`,
        [req.params.sessionId, getCurrentTimestampLocal()]
      ),
    ]);
    const secondsSince = (at) => Math.max(0, Math.round((Date.now() - toEpochMs(at)) / 1000));
    const secondsUntil = (at) => Math.max(0, Math.round((toEpochMs(at) - Date.now()) / 1000));

    const [streamRow] = await req.db.query(
      `SELECT s.sessionId, s.venueId, s.status, s.startAt, s.endAt, s.streamUrl,
              s.streamPlatform, s.streamLayout, s.streamUpdatedAt,
              c.camera2RtspUrl IS NOT NULL AS hasCamera2
       FROM recording_sessions s JOIN courts c ON c.courtId = s.courtId
       WHERE s.sessionId = ? LIMIT 1`,
      [req.params.sessionId]
    );

    return res.sendSuccess("Session retrieved successfully", {
      session: {
        ...toSession(rows[0]),
        stream: await describeStream(req.db, streamRow),
        devices: devices.map((device) => ({
          ...device,
          lastSeenSecondsAgo: device.lastSeenAt ? secondsSince(device.lastSeenAt) : null,
        })),
        pairingCodes: pairingCodes.map((key) => ({
          ...key,
          expiresInSeconds: secondsUntil(key.expiresAt),
        })),
        parts: parts.map(({ videoPath, thumbnailPath, ...part }) => {
          const ready = part.status === "Ready";
          return {
            ...part,
            videoUrl: ready ? signUploadUrl(videoPath) : null,
            downloadUrl: ready ? signedDownloadUrl(videoPath) : null,
            thumbnailUrl: ready ? signUploadUrl(thumbnailPath) : null,
          };
        }),
      },
    });
  })
);

/**
 * POST /
 * Book a court. The window may start now (up to a minute ago) or up to
 * SESSION_MAX_DAYS_AHEAD days ahead; sessions on one court never overlap.
 */
router.post(
  "/",
  checkPermission("clips", null, "write"),
  validateBody(createSessionSchema),
  catchAsync(async (req, res) => {
    const { courtId, startNow, startAt, durationMinutes, playerName, phone } = req.body;
    const start = startNow ? moment().tz(TIMEZONE) : moment.tz(startAt, FORMAT, TIMEZONE);
    if (!start.isValid()) {
      return res.sendError("Invalid start date and time", 400);
    }
    const nowM = moment().tz(TIMEZONE);
    if (start.isBefore(nowM.clone().subtract(1, "minute"))) {
      return res.sendError("A session can't start in the past", 400);
    }
    if (start.isAfter(nowM.clone().add(SESSION_MAX_DAYS_AHEAD, "days"))) {
      return res.sendError(`Book at most ${SESSION_MAX_DAYS_AHEAD} days ahead`, 400);
    }
    const startLocal = start.format(FORMAT);
    const endLocal = start.clone().add(durationMinutes, "minutes").format(FORMAT);
    const now = getCurrentTimestampLocal();

    let conn;
    try {
      conn = await req.db.beginTransaction();

      const [courts] = await conn.execute(
        `SELECT c.courtId, c.venueId, c.cameraRtspUrl IS NOT NULL AS hasCamera
         FROM courts c JOIN venues v ON v.venueId = c.venueId
         WHERE c.courtId = ? AND c.status = 'Active' AND v.status = 'Active'
         LIMIT 1 FOR UPDATE`,
        [courtId]
      );
      if (courts.length === 0) {
        await req.db.rollback(conn);
        return res.sendError("Court not found or not active", 404);
      }
      if (!courts[0].hasCamera) {
        await req.db.rollback(conn);
        return res.sendError("This court has no camera configured", 400);
      }

      // The court row is locked, so concurrent bookings are serialised
      const [overlap] = await conn.execute(
        `SELECT sessionId FROM recording_sessions
         WHERE courtId = ? AND status NOT IN ('Cancelled', 'Failed')
           AND startAt < ? AND endAt > ?
         LIMIT 1`,
        [courtId, endLocal, startLocal]
      );
      if (overlap.length > 0) {
        await req.db.rollback(conn);
        return res.sendError(
          startNow
            ? "This court already has a session running now — end it or pick a later time"
            : "This court already has a session in that time",
          409
        );
      }

      const [uuidRow] = await conn.execute(`SELECT UUID() as id`);
      const sessionId = uuidRow[0].id;
      const shareToken = randomToken();
      await conn.execute(
        `INSERT INTO recording_sessions
           (sessionId, venueId, courtId, startAt, endAt, playerName, phone, shareToken,
            createdByAccountId, status, dateCreated, dateUpdated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Scheduled', ?, ?)`,
        [
          sessionId,
          courts[0].venueId,
          courtId,
          startLocal,
          endLocal,
          playerName || null,
          phone || null,
          shareToken,
          req.user.accountId,
          now,
          now,
        ]
      );

      await req.db.commit(conn);
      return res.sendSuccess(
        "Session booked",
        { sessionId, startAt: startLocal, endAt: endLocal, shareUrl: sessionShareUrl(shareToken) },
        201
      );
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }
  })
);

/**
 * POST /:sessionId/cancel — only before it starts
 */
router.post(
  "/:sessionId/cancel",
  checkPermission("clips", null, "write"),
  catchAsync(async (req, res) => {
    const now = getCurrentTimestampLocal();
    const result = await req.db.query(
      `UPDATE recording_sessions SET status = 'Cancelled', dateUpdated = ?, ${FORGET_STREAM_SQL}
       WHERE sessionId = ? AND status = 'Scheduled' AND startAt > ?`,
      [now, req.params.sessionId, now]
    );
    if (result.affectedRows === 0) {
      const exists = await req.db.query(
        `SELECT status FROM recording_sessions WHERE sessionId = ? LIMIT 1`,
        [req.params.sessionId]
      );
      if (exists.length === 0) return res.sendError("Session not found", 404);
      return res.sendError("Only a session that hasn't started can be cancelled", 409);
    }
    return res.sendSuccess("Session cancelled");
  })
);

/**
 * POST /:sessionId/end — finish a running session now (players left early).
 * The footage so far is still delivered.
 */
router.post(
  "/:sessionId/end",
  checkPermission("clips", null, "write"),
  catchAsync(async (req, res) => {
    const result = await endSessionNow(req.db, req.params.sessionId);
    if (!result.ok) {
      return result.status === 404
        ? res.sendError("Session not found", 404)
        : res.sendError("Only a session that is recording can be ended", 409);
    }
    return res.sendSuccess("Session ended — its footage is being saved", { endAt: result.endAt });
  })
);

/**
 * POST /:sessionId/stream/stop — stop the player's own live stream (Phase G)
 */
router.post(
  "/:sessionId/stream/stop",
  checkPermission("clips", null, "write"),
  catchAsync(async (req, res) => {
    const rows = await req.db.query(
      `SELECT sessionId FROM recording_sessions WHERE sessionId = ? LIMIT 1`,
      [req.params.sessionId]
    );
    if (rows.length === 0) return res.sendError("Session not found", 404);
    await clearStream(req.db, req.params.sessionId);
    return res.sendSuccess("Live stream stopped");
  })
);

/** Sessions a device can still be paired to. */
const SESSION_PAIRABLE = ["Scheduled", "Recording"];

/**
 * POST /:sessionId/pairing-codes — a 6-digit key that pairs a phone/tablet to
 * this session (PLAN-002 Phase E). Shown once; works for 10 minutes or until
 * the session ends, whichever is first.
 */
router.post(
  "/:sessionId/pairing-codes",
  checkPermission("clips", null, "write"),
  validateBody(createSessionPairingCodeSchema),
  catchAsync(async (req, res) => {
    const now = getCurrentTimestampLocal();
    let conn;
    let created;
    try {
      conn = await req.db.beginTransaction();
      const [sessions] = await conn.execute(
        `SELECT s.sessionId, s.venueId, s.endAt, s.status
         FROM recording_sessions s JOIN venues v ON v.venueId = s.venueId AND v.status != 'Deleted'
         WHERE s.sessionId = ?
         LIMIT 1 FOR UPDATE`,
        [req.params.sessionId]
      );
      if (sessions.length === 0) {
        await req.db.rollback(conn);
        return res.sendError("Session not found", 404);
      }
      const session = sessions[0];
      if (!SESSION_PAIRABLE.includes(session.status) || session.endAt <= now) {
        await req.db.rollback(conn);
        return res.sendError("This session has ended — devices can't be paired to it", 409);
      }
      created = await createPairingCode(conn, {
        kind: "APP",
        venueId: session.venueId,
        sessionId: session.sessionId,
        name: req.body.name,
        accountId: req.user.accountId,
        expiresBy: session.endAt,
      });
      await req.db.commit(conn);
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }

    noIdempotencyCache(res); // the key must never sit in the cache table
    const expiresInSeconds = Math.max(
      0,
      Math.round((toEpochMs(created.expiresAt) - Date.now()) / 1000)
    );
    return res.sendSuccess(
      `Pairing key created — it works once, for up to ${PAIRING_CODE_TTL_MINUTES} minutes`,
      { ...created, expiresInSeconds },
      201
    );
  })
);

/**
 * DELETE /:sessionId/pairing-codes/:pairingCodeId — cancel a key nobody used yet
 */
router.delete(
  "/:sessionId/pairing-codes/:pairingCodeId",
  checkPermission("clips", null, "write"),
  catchAsync(async (req, res) => {
    const result = await req.db.query(
      `UPDATE pairing_codes SET status = 'Cancelled', dateUpdated = ?
       WHERE pairingCodeId = ? AND sessionId = ? AND kind = 'APP' AND status = 'Active'`,
      [getCurrentTimestampLocal(), req.params.pairingCodeId, req.params.sessionId]
    );
    if (result.affectedRows === 0) {
      return res.sendError("Pairing key not found", 404);
    }
    return res.sendSuccess("Pairing key cancelled");
  })
);

/**
 * POST /:sessionId/devices/:pairedAppId/unpair — the device stops at its next request
 */
router.post(
  "/:sessionId/devices/:pairedAppId/unpair",
  checkPermission("clips", null, "write"),
  catchAsync(async (req, res) => {
    const result = await req.db.query(
      `UPDATE paired_apps SET status = 'Revoked', dateUpdated = ?
       WHERE pairedAppId = ? AND sessionId = ? AND status = 'Active'`,
      [getCurrentTimestampLocal(), req.params.pairedAppId, req.params.sessionId]
    );
    if (result.affectedRows === 0) {
      return res.sendError("Device not found", 404);
    }
    return res.sendSuccess("Device unpaired");
  })
);

export default router;
