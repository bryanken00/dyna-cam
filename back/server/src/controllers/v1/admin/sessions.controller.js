import express from "express";
import { catchAsync, validateBody, validateQuery } from "../../../utils/catchAsync.js";
import { getCurrentTimestampLocal, moment } from "../../../utils/dateUtils.js";
import { checkPermission } from "../../../middlewares/checkPermission.middleware.js";
import { randomToken } from "../../../utils/crypto/tokens.js";
import { sessionShareUrl } from "../../../utils/clips.js";
import { signedDownloadUrl, signUploadUrl } from "../../../utils/file/signedUrl.js";
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
 * See utils/sessions.js for how a session becomes 5-minute parts.
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
           AS partsReady
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

    return res.sendSuccess("Session retrieved successfully", {
      session: {
        ...toSession(rows[0]),
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
    const { courtId, startAt, durationMinutes, playerName, phone } = req.body;
    const start = moment.tz(startAt, FORMAT, TIMEZONE);
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
        return res.sendError("This court already has a session in that time", 409);
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
      `UPDATE recording_sessions SET status = 'Cancelled', dateUpdated = ?
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

export default router;
