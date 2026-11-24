import express from "express";
import {
  catchAsync,
  validateBody,
  validateParams,
  validateQuery,
} from "../../../utils/catchAsync.js";
import { getCurrentTimestampLocal, moment } from "../../../utils/dateUtils.js";
import { checkPermission } from "../../../middlewares/checkPermission.middleware.js";
import { randomToken } from "../../../utils/crypto/tokens.js";
import { DRIVE_KEEP_DAYS, driveKeepCutoff } from "../../../utils/driveKeep.js";
import { insertWithPayCode } from "../../../utils/payments.js";
import { sessionShareUrl, toEpochMs } from "../../../utils/clips.js";
import { noIdempotencyCache } from "../../../middlewares/idempotency.middleware.js";
import { createPairingCode, PAIRING_CODE_TTL_MINUTES } from "../../../utils/pairing.js";
import { createSessionPairingCodeSchema } from "../../../validators/pairing.validator.js";
import { clearStream, describeStream, FORGET_STREAM_SQL } from "../../../utils/sessionStreams.js";
import {
  endSessionNow,
  materializeSessionParts,
  openGameEnd,
  SESSION_MAX_DAYS_AHEAD,
  settleSessions,
  uploadPercent,
} from "../../../utils/sessions.js";
import {
  createSessionSchema,
  extendSessionSchema,
  GAME_MAX_TOTAL_MINUTES,
  listSessionsQuerySchema,
  sessionVideoParamsSchema,
  updateSessionEmailSchema,
} from "../../../validators/sessions.validator.js";
import { loadSessionVideos, toAdminVideo } from "../../../utils/sessionVideos.js";
import { captureLimits, loadCaptures } from "../../../utils/sessionCaptures.js";
import { bookCourt } from "../../../utils/gameStart.js";
import { findConflict } from "../../../utils/courtTimeline.js";
import {
  DRIVE_EMAIL_COLUMNS,
  driveEmailState,
  sendGameDriveEmail,
} from "../../../utils/gameEmails.js";

/**
 * Recording sessions — a court booked for a whole time window (PLAN-001
 * Phase 3). Permission: clips (a session's footage is delivered as clips).
 * See utils/sessions.js for how a game becomes one video per camera (CR-006). Phones/tablets
 * are paired to one session here (PLAN-002 Phase E, /:sessionId/pairing-codes)
 * and see it live through /api/v1/app (utils/sessionDevices.js).
 */
const router = express.Router();

const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";
const FORMAT = "YYYY-MM-DD HH:mm:ss";

/** A kept video of `s` (alias `dv`): the whole game per camera, and CR-013 saves. */
const KEPT_VIDEO = `dv.sessionId = s.sessionId AND dv.status = 'Ready'`;

/** CR-018 (2026-11-20): how the game's Drive upload went — for driveUploadState. */
const DRIVE_UPLOAD_COLUMNS = `
  (SELECT COUNT(*) FROM session_videos dv
   WHERE ${KEPT_VIDEO} AND dv.driveStatus IN ('Pending', 'Uploading')) AS driveUploadingCount,
  (SELECT COUNT(*) FROM session_videos dv
   WHERE ${KEPT_VIDEO} AND dv.driveStatus = 'Failed') AS driveFailedCount,
  (SELECT COUNT(*) FROM session_videos dv
   WHERE ${KEPT_VIDEO} AND (dv.driveStatus IN ('Failed', 'Skipped') OR dv.driveStatus IS NULL))
    AS driveMissingCount,
  (SELECT dv.driveError FROM session_videos dv
   WHERE ${KEPT_VIDEO} AND dv.driveStatus IN ('Failed', 'Skipped') AND dv.driveError IS NOT NULL
   ORDER BY dv.dateUpdated DESC LIMIT 1) AS driveLastError,
  (c.driveRefreshToken IS NOT NULL AND c.status != 'Deleted') AS courtDriveLinked,
  c.driveStatus AS courtDriveStatus`;

const SESSION_SELECT = `
  SELECT s.sessionId, s.venueId, v.name AS venueName, s.courtId, c.name AS courtName,
         s.startAt, s.endAt, s.playerName, s.phone, s.shareToken, s.status, s.failureReason,
         s.partCameras, s.wholeVideo, s.openEnded, s.maxCaptures, s.addedMinutes, s.paymentStatus,
         s.payCode, s.dateCreated, s.dateUpdated, s.driveUrl AS driveFolderUrl,
         ${DRIVE_EMAIL_COLUMNS},
         ${DRIVE_UPLOAD_COLUMNS},
         EXISTS (SELECT 1 FROM session_videos dv
                 WHERE dv.sessionId = s.sessionId AND dv.status = 'Ready'
                   AND dv.driveStatus = 'Uploaded') AS driveReady,
         (SELECT SUM(p.amount) FROM payments p WHERE p.sessionId = s.sessionId AND p.status = 'Paid')
           AS paidAmount,
         s.bookingId, bk.bookingCode,
         COALESCE(IF(s.bookingId IS NOT NULL, CONCAT('Booking ', bk.bookingCode), NULL),
                  CONCAT(u.firstName, ' ', u.lastName), CONCAT(pa.name, ' (phone)'),
                  IF(s.startedByPlayer = 1, 'Player (QR)', NULL)) AS startedBy,
         (SELECT COUNT(*) FROM session_videos sv
          WHERE sv.sessionId = s.sessionId AND sv.captureId IS NULL AND sv.status = 'Ready')
           AS videosReady,
         (SELECT COUNT(*) FROM session_videos sv
          WHERE sv.sessionId = s.sessionId AND sv.captureId IS NULL AND sv.status != 'Deleted')
           AS videosTotal,
         (SELECT COUNT(*) FROM paired_apps d WHERE d.sessionId = s.sessionId AND d.status = 'Active')
           AS devicesCount
  FROM recording_sessions s
  JOIN venues v ON v.venueId = s.venueId
  JOIN courts c ON c.courtId = s.courtId
  LEFT JOIN users u ON u.accountId = s.createdByAccountId
  LEFT JOIN paired_apps pa ON pa.pairedAppId = s.pairedAppId
  LEFT JOIN bookings bk ON bk.bookingId = s.bookingId`;

/**
 * CR-018 (2026-11-20): the game's Google Drive upload, for Re-upload in Sessions.
 *   status: Uploading · Failed · NotUploaded (never ran / skipped) · Uploaded
 *           · NoDrive (court without Drive, nothing in it) · None (nothing kept)
 *   canReupload: something kept isn't in Drive and the court's Drive is connected
 *   problem: why it can't be re-uploaded right now (court not connected / needs reconnect)
 */
const driveUploadState = (row) => {
  const uploading = Number(row.driveUploadingCount || 0);
  const failed = Number(row.driveFailedCount || 0);
  const missing = Number(row.driveMissingCount || 0);
  const linked = Number(row.courtDriveLinked) === 1;
  const connected = linked && row.courtDriveStatus === "Connected";
  let status = "None";
  if (uploading > 0) status = "Uploading";
  else if (failed > 0) status = "Failed";
  else if (missing > 0) status = linked ? "NotUploaded" : "NoDrive";
  else if (Number(row.driveReady) === 1) status = "Uploaded";
  return {
    status,
    error: ["Failed", "NotUploaded"].includes(status) ? row.driveLastError || null : null,
    canReupload: connected && uploading === 0 && missing > 0,
    problem: !linked
      ? "This court has no Google Drive connected"
      : connected
        ? null
        : "The court's Google Drive needs reconnecting",
  };
};

/** CR-005: an open game still waiting or recording has no real end time yet. */
const isOpen = (row) =>
  Number(row.openEnded) === 1 && ["Waiting", "Recording"].includes(row.status);

const toSession = (row) => {
  const {
    shareToken,
    openEnded,
    driveFolderUrl,
    driveReady,
    driveEmailStatus: _driveEmailStatus,
    driveEmailTo: _driveEmailTo,
    driveEmailSentAt: _driveEmailSentAt,
    driveEmailError: _driveEmailError,
    driveEmailReady: _driveEmailReady,
    driveEmailUploading: _driveEmailUploading,
    driveUploadingCount: _driveUploadingCount,
    driveFailedCount: _driveFailedCount,
    driveMissingCount: _driveMissingCount,
    driveLastError: _driveLastError,
    courtDriveLinked: _courtDriveLinked,
    courtDriveStatus: _courtDriveStatus,
    ...session
  } = row;
  const open = isOpen(row);
  const nowM = moment().tz(TIMEZONE);
  return {
    ...session,
    openEnded: Number(openEnded) === 1,
    // While open: no end, and its length so far (0 while waiting for a device)
    startAt: row.status === "Waiting" ? null : row.startAt,
    endAt: open ? null : row.endAt,
    durationMinutes: open
      ? row.status === "Recording"
        ? Math.max(0, nowM.diff(moment.tz(row.startAt, FORMAT, TIMEZONE), "minutes"))
        : 0
      : moment(row.endAt).diff(moment(row.startAt), "minutes"),
    // CR-006: the game's whole videos (one per camera), made after it ends
    videosReady: Number(row.videosReady || 0),
    videosTotal: Number(row.videosTotal || 0),
    devicesCount: Number(row.devicesCount || 0),
    // CR-015: Unpaid until staff record the payment (Free = a game from before)
    paidAmount: row.paidAmount === null || row.paidAmount === undefined ? null : Number(row.paidAmount),
    // CR-013: saves the courtside device may hold at once (chosen on New game)
    maxCaptures: captureLimits(row).maxPerGame,
    // CR-016: time staff added after New game (Add time)
    addedMinutes: Number(row.addedMinutes || 0),
    shareUrl: sessionShareUrl(shareToken),
    // CR-001 (2026-11-20): the game's shared Drive folder, for staff to show as a
    // QR — once a kept video of it is in Drive (CR-017: gone once they're deleted)
    driveUrl: Number(driveReady) === 1 && driveFolderUrl ? driveFolderUrl : null,
    // CR-018: the player's email and where the Drive-link email stands
    email: row.email || null,
    driveEmail: driveEmailState(row),
    // CR-018 (2026-11-20): Re-upload to Google Drive
    driveUpload: driveUploadState(row),
  };
};

/** One session as Admin shows it (after a change). */
const loadSession = async (db, sessionId) => {
  const rows = await db.query(`${SESSION_SELECT} WHERE s.sessionId = ? LIMIT 1`, [sessionId]);
  return rows[0] ? toSession(rows[0]) : null;
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

    const {
      page = 1,
      pageSize = 20,
      venueId,
      courtId,
      status,
      payment,
      search = "",
      sortOrder,
    } = req.query;
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
    if (payment) {
      whereClause += " AND s.paymentStatus = ?";
      params.push(payment);
    }
    if (search) {
      // CR-015: or the game code the player shows at the desk ("k7qm 2p" works too)
      whereClause +=
        " AND (s.playerName LIKE ? OR c.name LIKE ? OR v.name LIKE ? OR s.payCode = ?)";
      params.push(
        `%${search}%`,
        `%${search}%`,
        `%${search}%`,
        search.replace(/\s+/g, "").toUpperCase()
      );
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

    // CR-003 / CR-006: the whole video per camera
    const videos = await loadSessionVideos(req.db, req.params.sessionId);
    // CR-013: stretches saved from the courtside device
    const captures = await loadCaptures(req.db, req.params.sessionId, toAdminVideo, {
      withIds: true,
    });

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
        videos: videos.map(toAdminVideo),
        uploadPercent: uploadPercent(videos),
        captures,
      },
    });
  })
);

/**
 * CR-005: a new open game on a court — no times. It waits for a session
 * device; the first one to pair starts the recording (pairing.controller.js),
 * and only End game / End stops it. One open game per court.
 */
const createOpenGame = async (req, res) => {
  const { courtId, playerName, phone, email, maxCaptures } = req.body;
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
    // The court row is locked, so two New games on one court can't both pass
    const [busy] = await conn.execute(
      `SELECT sessionId FROM recording_sessions
       WHERE courtId = ? AND endAt > ?
         AND (status IN ('Waiting', 'Recording') OR (status = 'Scheduled' AND startAt <= ?))
       LIMIT 1`,
      [courtId, now, now]
    );
    if (busy.length > 0) {
      await req.db.rollback(conn);
      return res.sendError("This court already has a game — end it before starting a new one", 409);
    }
    // PLAN-003: an open game's rolling end reaches OPEN_GAME_AHEAD_HOURS ahead,
    // so a booking or closure inside that would be run over
    const ahead = await findConflict(conn, {
      courtId,
      startLocal: now,
      endLocal: openGameEnd(),
      now,
    });
    if (ahead) {
      await req.db.rollback(conn);
      const from = moment.tz(ahead.from, FORMAT, TIMEZONE).format("h:mm A");
      return res.sendError(
        ahead.type === "CLOSURE"
          ? `This court is closed from ${from} — give the game a game time that ends before then`
          : ahead.type === "BOOKING"
            ? `Booking ${ahead.code} has this court from ${from} — give the game a game time that ends before then`
            : "This court already has a game — end it before starting a new one",
        409
      );
    }

    const [uuidRow] = await conn.execute(`SELECT UUID() as id`);
    const sessionId = uuidRow[0].id;
    const shareToken = randomToken();
    // startAt is a placeholder until a device pairs; endAt rolls (utils/sessions.js).
    // CR-015: unpaid, with the code the player shows at the desk — or free
    // (staff chose "Free game"): no code, open to the player at once
    const payCode = await insertWithPayCode((code) =>
      conn.execute(
        `INSERT INTO recording_sessions
           (sessionId, venueId, courtId, startAt, endAt, playerName, phone, email, shareToken,
            createdByAccountId, openEnded, maxCaptures, status, paymentStatus, payCode,
            dateCreated, dateUpdated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'Waiting', ?, ?, ?, ?)`,
        [
          sessionId,
          courts[0].venueId,
          courtId,
          now,
          openGameEnd(),
          playerName || null,
          phone || null,
          email || null,
          shareToken,
          req.user.accountId,
          maxCaptures ?? null,
          code ? "Unpaid" : "Free",
          code,
          now,
          now,
        ]
      ),
      { conn, free: Boolean(req.body.free) }
    );
    await req.db.commit(conn);
    return res.sendSuccess(
      "Game created — pair the court's device to start recording",
      { sessionId, status: "Waiting", payCode, shareUrl: sessionShareUrl(shareToken) },
      201
    );
  } catch (err) {
    await req.db.rollback(conn);
    throw err;
  }
};

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
    const { courtId, startNow, startAt, durationMinutes, playerName, phone, email, maxCaptures } =
      req.body;
    if (!startNow && !startAt) return createOpenGame(req, res);
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

    // CR-016: a game started now records at once — no device needed — and
    // stops by itself at endLocal (advanceSessions)
    const status = startNow ? "Recording" : "Scheduled";
    let conn;
    try {
      conn = await req.db.beginTransaction();
      const booked = await bookCourt(conn, {
        courtId,
        startLocal,
        endLocal,
        status,
        now,
        playerName,
        phone,
        email,
        maxCaptures,
        free: Boolean(req.body.free),
        createdByAccountId: req.user.accountId,
      });
      if (!booked.ok) {
        await req.db.rollback(conn);
        if (booked.reason === "COURT_NOT_FOUND") {
          return res.sendError("Court not found or not active", 404);
        }
        if (booked.reason === "NO_CAMERA") {
          return res.sendError("This court has no camera configured", 400);
        }
        // PLAN-003: a booking or closure in the way is named, so staff can find it
        const { conflict } = booked;
        if (conflict?.type === "BOOKING") {
          return res.sendError(
            `Booking ${conflict.code} has this court from ${moment
              .tz(conflict.from, FORMAT, TIMEZONE)
              .format("h:mm A")} — pick a shorter game time or another court`,
            409
          );
        }
        if (conflict?.type === "CLOSURE") {
          return res.sendError(
            `This court is closed from ${moment
              .tz(conflict.from, FORMAT, TIMEZONE)
              .format("MMM D, h:mm A")} — pick a shorter game time or another court`,
            409
          );
        }
        return res.sendError(
          startNow
            ? "This court already has a game — end it before starting a new one"
            : "This court already has a session in that time",
          409
        );
      }
      const { sessionId, shareToken, payCode } = booked;

      await req.db.commit(conn);
      return res.sendSuccess(
        startNow ? "Game created — recording now" : "Session booked",
        {
          sessionId,
          status,
          startAt: startLocal,
          endAt: endLocal,
          payCode,
          shareUrl: sessionShareUrl(shareToken),
        },
        201
      );
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }
  })
);

/**
 * POST /:sessionId/cancel — only before it starts: a booked session before its
 * start time, or an open game still waiting for a device (CR-005)
 */
router.post(
  "/:sessionId/cancel",
  checkPermission("clips", null, "write"),
  catchAsync(async (req, res) => {
    const now = getCurrentTimestampLocal();
    const result = await req.db.query(
      `UPDATE recording_sessions SET status = 'Cancelled', dateUpdated = ?, ${FORGET_STREAM_SQL}
       WHERE sessionId = ? AND (status = 'Waiting' OR (status = 'Scheduled' AND startAt > ?))`,
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
 * POST /:sessionId/extend — CR-016: Add time to a game that is recording with
 * a game time. Moves its end later (at most GAME_MAX_TOTAL_MINUTES in all);
 * the payment is left as it is. Open games (CR-005) have no end to move.
 */
router.post(
  "/:sessionId/extend",
  checkPermission("clips", null, "write"),
  validateBody(extendSessionSchema),
  catchAsync(async (req, res) => {
    const { minutes } = req.body;
    const now = getCurrentTimestampLocal();
    let conn;
    try {
      conn = await req.db.beginTransaction();
      const [sessions] = await conn.execute(
        `SELECT s.sessionId, s.courtId, s.bookingId, s.startAt, s.endAt, s.status, s.openEnded
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
      if (session.status !== "Recording" || Number(session.openEnded) === 1 || session.endAt <= now) {
        await req.db.rollback(conn);
        return res.sendError("Time can only be added to a game that is recording", 409);
      }
      const start = moment.tz(session.startAt, FORMAT, TIMEZONE);
      const newEnd = moment.tz(session.endAt, FORMAT, TIMEZONE).add(minutes, "minutes");
      if (newEnd.diff(start, "minutes") > GAME_MAX_TOTAL_MINUTES) {
        await req.db.rollback(conn);
        const left = Math.max(
          0,
          GAME_MAX_TOTAL_MINUTES -
            moment.tz(session.endAt, FORMAT, TIMEZONE).diff(start, "minutes")
        );
        return res.sendError(
          left > 0
            ? `A game is at most 6 hours — at most ${left} more minutes can be added`
            : "A game is at most 6 hours — no more time can be added",
          400
        );
      }
      const newEndLocal = newEnd.format(FORMAT);
      // PLAN-003: lock the court like every other timeline writer, then check
      // the added time — a game, booking or closure after it keeps its time
      await conn.execute(`SELECT courtId FROM courts WHERE courtId = ? FOR UPDATE`, [
        session.courtId,
      ]);
      const inTheWay = await findConflict(conn, {
        courtId: session.courtId,
        startLocal: session.endAt,
        endLocal: newEndLocal,
        ignoreBookingId: session.bookingId,
        now,
      });
      if (inTheWay) {
        await req.db.rollback(conn);
        return res.sendError(
          inTheWay.type === "BOOKING"
            ? `Booking ${inTheWay.code} has this court from ${moment
                .tz(inTheWay.from, FORMAT, TIMEZONE)
                .format("h:mm A")} — add less time`
            : inTheWay.type === "CLOSURE"
              ? "The court is closed in that time — add less time"
              : "Another session is booked on this court in that time",
          409
        );
      }
      await conn.execute(
        `UPDATE recording_sessions
         SET endAt = ?, addedMinutes = addedMinutes + ?, dateUpdated = ?
         WHERE sessionId = ?`,
        [newEndLocal, minutes, now, session.sessionId]
      );
      await req.db.commit(conn);
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }

    const rows = await req.db.query(`${SESSION_SELECT} WHERE s.sessionId = ? LIMIT 1`, [
      req.params.sessionId,
    ]);
    return res.sendSuccess(`Added ${minutes} min to the game`, { session: toSession(rows[0]) });
  })
);

/**
 * PATCH /:sessionId/email — CR-018: fix (or clear) the player's email. A new
 * address gets the Drive-link email again (the automatic send starts over).
 */
router.patch(
  "/:sessionId/email",
  checkPermission("clips", null, "write"),
  validateBody(updateSessionEmailSchema),
  catchAsync(async (req, res) => {
    const email = req.body.email || null;
    const rows = await req.db.query(
      `SELECT s.email FROM recording_sessions s
       JOIN venues v ON v.venueId = s.venueId AND v.status != 'Deleted'
       WHERE s.sessionId = ? LIMIT 1`,
      [req.params.sessionId]
    );
    if (rows.length === 0) return res.sendError("Session not found", 404);
    if ((rows[0].email || null) !== email) {
      await req.db.query(
        `UPDATE recording_sessions
         SET email = ?, driveEmailStatus = NULL, driveEmailTo = NULL, driveEmailSentAt = NULL,
             driveEmailAttempts = 0, driveEmailNextAttemptAt = NULL, driveEmailError = NULL,
             dateUpdated = ?
         WHERE sessionId = ?`,
        [email, getCurrentTimestampLocal(), req.params.sessionId]
      );
    }
    return res.sendSuccess(email ? "Player email saved" : "Player email removed", {
      session: await loadSession(req.db, req.params.sessionId),
    });
  })
);

/**
 * POST /:sessionId/drive-upload — CR-018 (2026-11-20): upload the game's kept
 * videos (whole game and saves) to the court's Google Drive again — the ones
 * whose upload failed, was skipped, or never ran (the court was connected
 * after the game). jobs/driveUploads.js picks them up within 30 s; the
 * Drive-link email follows by itself if it wasn't sent.
 */
router.post(
  "/:sessionId/drive-upload",
  checkPermission("clips", null, "write"),
  catchAsync(async (req, res) => {
    const rows = await req.db.query(
      `SELECT c.driveRefreshToken IS NOT NULL AND c.status != 'Deleted' AS linked,
              c.driveStatus AS courtDriveStatus
       FROM recording_sessions s
       JOIN venues v ON v.venueId = s.venueId AND v.status != 'Deleted'
       JOIN courts c ON c.courtId = s.courtId
       WHERE s.sessionId = ? LIMIT 1`,
      [req.params.sessionId]
    );
    if (rows.length === 0) return res.sendError("Session not found", 404);
    if (Number(rows[0].linked) !== 1) {
      return res.sendError(
        "This court has no Google Drive connected — connect it in the court's setup first",
        409
      );
    }
    if (rows[0].courtDriveStatus !== "Connected") {
      return res.sendError("Reconnect the court's Google Drive first (court setup)", 409);
    }

    const now = getCurrentTimestampLocal();
    const queued = await req.db.query(
      `UPDATE session_videos
       SET driveStatus = 'Pending', driveAttempts = 0, driveNextAttemptAt = NULL,
           driveError = NULL, dateUpdated = ?
       WHERE sessionId = ? AND status = 'Ready'
         AND (driveStatus IN ('Failed', 'Skipped') OR driveStatus IS NULL)
         AND dateCreated > ?`,
      // CR-026: Drive keeps a video only DRIVE_KEEP_DAYS after it's saved
      [now, req.params.sessionId, driveKeepCutoff()]
    );
    if (!queued.affectedRows) {
      return res.sendError(
        `Nothing to upload — the game's videos are already in Google Drive, uploading, or older than the ${DRIVE_KEEP_DAYS} days Google Drive keeps them`,
        409
      );
    }
    return res.sendSuccess(
      `Uploading ${queued.affectedRows} ${queued.affectedRows === 1 ? "video" : "videos"} to Google Drive — within a minute`,
      { session: await loadSession(req.db, req.params.sessionId) }
    );
  })
);

/**
 * POST /:sessionId/drive-email — CR-018: email the game's Google Drive link to
 * the player now (again). Needs an email, a paid or free game, and its videos
 * in Drive.
 */
router.post(
  "/:sessionId/drive-email",
  checkPermission("clips", null, "write"),
  catchAsync(async (req, res) => {
    const live = await req.db.query(
      `SELECT s.sessionId FROM recording_sessions s
       JOIN venues v ON v.venueId = s.venueId AND v.status != 'Deleted'
       WHERE s.sessionId = ? LIMIT 1`,
      [req.params.sessionId]
    );
    if (live.length === 0) return res.sendError("Session not found", 404);
    const before = await loadSession(req.db, req.params.sessionId);
    if (!before.email) return res.sendError("Add the player's email first", 409);
    if (before.paymentStatus === "Unpaid") {
      return res.sendError("The game isn't paid yet — record the payment first", 409);
    }
    if (before.driveEmail.status === "NotSetUp") {
      return res.sendError(
        "Email isn't set up on the server — add SENDGRID_API_KEY to the API's .env",
        409
      );
    }
    if (!["Queued", "Sent", "Failed"].includes(before.driveEmail.status)) {
      return res.sendError("The game's videos aren't in Google Drive yet", 409);
    }

    const now = getCurrentTimestampLocal();
    // Claimed so the automatic send can't send it at the same moment
    const claimed = await req.db.query(
      `UPDATE recording_sessions SET driveEmailStatus = 'Sending', driveEmailNextAttemptAt = ?
       WHERE sessionId = ?
         AND (driveEmailStatus IS NULL OR driveEmailStatus IN ('Sent', 'Failed')
              OR driveEmailNextAttemptAt <= ?)`,
      [moment().tz(TIMEZONE).add(5, "minutes").format(FORMAT), req.params.sessionId, now]
    );
    if (!claimed.affectedRows) {
      return res.sendError("The email is being sent right now — check again in a moment", 409);
    }

    try {
      const sent = await sendGameDriveEmail(req.db, req.params.sessionId);
      if (!sent.sent) throw new Error("The game is no longer ready for the email");
      await req.db.query(
        `UPDATE recording_sessions
         SET driveEmailStatus = 'Sent', driveEmailTo = ?, driveEmailSentAt = ?,
             driveEmailError = NULL, driveEmailNextAttemptAt = NULL
         WHERE sessionId = ?`,
        [sent.to, getCurrentTimestampLocal(), req.params.sessionId]
      );
      return res.sendSuccess(`Google Drive link emailed to ${sent.to}`, {
        session: await loadSession(req.db, req.params.sessionId),
      });
    } catch (err) {
      // Back to how it was (a sent email stays "Sent"), with why this try failed
      await req.db.query(
        `UPDATE recording_sessions
         SET driveEmailStatus = IF(driveEmailSentAt IS NULL, 'Failed', 'Sent'),
             driveEmailError = ?, driveEmailNextAttemptAt = NULL
         WHERE sessionId = ?`,
        [String(err.message || "Sending failed").slice(0, 255), req.params.sessionId]
      );
      return res.sendError(`Couldn't send the email: ${err.message}`, 502);
    }
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

/** Sessions a device can still be paired to (CR-005: a waiting game too — pairing starts it). */
const SESSION_PAIRABLE = ["Waiting", "Scheduled", "Recording"];

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

/**
 * POST /:sessionId/videos/:camera/retry  (CR-006)
 * Ask the recorder box to make and send a failed game video again. Works while
 * the box still has the game's footage: the game is listed in its /config
 * again until the video is in.
 */
router.post(
  "/:sessionId/videos/:camera/retry",
  checkPermission("clips", null, "write"),
  validateParams(sessionVideoParamsSchema),
  catchAsync(async (req, res) => {
    const result = await req.db.query(
      `UPDATE session_videos sv
       JOIN recording_sessions s ON s.sessionId = sv.sessionId AND s.status != 'Cancelled'
       SET sv.status = 'Pending', sv.attempts = 0, sv.nextAttemptAt = NULL, sv.deviceId = NULL,
           sv.uploadBytes = NULL, sv.receivedBytes = 0, sv.failureReason = NULL,
           sv.dateUpdated = ?
       WHERE sv.sessionId = ? AND sv.captureId IS NULL AND sv.camera = ? AND sv.status = 'Failed'`,
      [getCurrentTimestampLocal(), req.params.sessionId, req.params.camera]
    );
    if (result.affectedRows === 0) {
      return res.sendError("No failed whole-game video for this camera", 404);
    }
    // Back to Processing: the box keeps the footage and gets the job again
    await req.db.query(
      `UPDATE recording_sessions SET status = 'Processing', wholeVideo = 'Pending', dateUpdated = ?
       WHERE sessionId = ? AND status IN ('Ready', 'Failed')`,
      [getCurrentTimestampLocal(), req.params.sessionId]
    );
    return res.sendSuccess(
      "Asked the recorder box to send this video again — it works while the box still has the game's footage"
    );
  })
);

export default router;
