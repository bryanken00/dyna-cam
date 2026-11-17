import express from "express";
import { catchAsync, validateBody, validateQuery } from "../../../utils/catchAsync.js";
import { getCurrentTimestampLocal, moment } from "../../../utils/dateUtils.js";
import { checkPermission } from "../../../middlewares/checkPermission.middleware.js";
import {
  courtQrUrl,
  DEVICE_ONLINE_SECONDS,
  isOnline,
  secondsAgoLocal,
  toEpochMs,
} from "../../../utils/clips.js";
import {
  cameraVersion,
  decryptSecret,
  encryptSecret,
  maskRtmpUrl,
  maskStreamUrl,
} from "../../../utils/crypto/secretBox.js";
import { randomToken } from "../../../utils/crypto/tokens.js";
import { signUploadUrl } from "../../../utils/file/signedUrl.js";
import {
  createCourtSchema,
  listCourtsQuerySchema,
  updateCourtSchema,
} from "../../../validators/courts.validator.js";

/**
 * Courts — one camera each, inside a venue (PLAN-001).
 * Permission: venues / courts.
 *
 * The camera URL is write-only here: it carries the camera's credentials, so
 * responses only say whether one is set and show it with the credentials
 * removed. The plaintext goes only to the venue's own recorder box.
 */
const router = express.Router();

const COURT_SELECT = `
  SELECT c.courtId, c.venueId, v.name AS venueName, v.logoUrl AS venueLogoUrl, c.name,
         c.cameraRtspUrl, c.qrToken, c.buttonCode, c.streamEnabled, c.streamRtmpUrl,
         c.streamWatchUrl, c.snapshotPath, c.snapshotAt,
         c.status, c.dateCreated, c.dateUpdated,
         EXISTS (
           SELECT 1 FROM devices d
           WHERE d.venueId = c.venueId AND d.status = 'Active' AND d.lastSeenAt >= ?
         ) AS recorderOnline
  FROM courts c
  JOIN venues v ON v.venueId = c.venueId AND v.status != 'Deleted'`;

/** Seconds since a stored Manila timestamp, by the server's clock (null if none). */
const secondsSince = (localTimestamp) =>
  localTimestamp ? Math.max(0, Math.round((Date.now() - toEpochMs(localTimestamp)) / 1000)) : null;

/**
 * What each court's camera looks like to its venue's recorder box right now
 * (PLAN-002 camera setup): the latest heartbeat entry for the court, from the
 * most recently seen Active box of the venue.
 * @returns {Promise<Map<string, Object>>} courtId → live camera info
 */
const liveCameras = async (db, venueIds) => {
  const live = new Map();
  if (venueIds.length === 0) return live;
  const devices = await db.query(
    `SELECT venueId, name, lastSeenAt, lastStatus FROM devices
     WHERE status = 'Active' AND venueId IN (${venueIds.map(() => "?").join(", ")})
     ORDER BY lastSeenAt ASC`,
    venueIds
  );
  for (const device of devices) {
    const status =
      typeof device.lastStatus === "string" ? JSON.parse(device.lastStatus) : device.lastStatus;
    for (const camera of status?.cameras || []) {
      // Later rows (more recently seen boxes) win
      live.set(camera.courtId, {
        status: camera.status,
        message: camera.message || null,
        video: camera.video || null,
        audio: camera.audio || null,
        boxName: device.name,
        boxOnline: isOnline(device.lastSeenAt),
        reportedAt: status.reportedAt || null,
        // Ages from the server's clock, not the browser's
        reportedSecondsAgo: secondsSince(status.reportedAt),
        cameraVersion: camera.cameraVersion || null,
      });
    }
  }
  return live;
};

/** Button codes are unique across every court (one press must reach one court). */
const buttonCodeTaken = async (conn, buttonCode, exceptCourtId = null) => {
  if (!buttonCode) return false;
  const [rows] = exceptCourtId
    ? await conn.execute(
        `SELECT courtId FROM courts WHERE buttonCode = ? AND courtId != ? LIMIT 1 FOR UPDATE`,
        [buttonCode, exceptCourtId]
      )
    : await conn.execute(`SELECT courtId FROM courts WHERE buttonCode = ? LIMIT 1 FOR UPDATE`, [
        buttonCode,
      ]);
  return rows.length > 0;
};

const toCourt = (row, live = null) => {
  const {
    cameraRtspUrl,
    streamRtmpUrl,
    streamEnabled,
    streamWatchUrl,
    snapshotPath,
    snapshotAt,
    ...court
  } = row;
  const plain = decryptSecret(cameraRtspUrl);
  return {
    ...court,
    venueLogoUrl: signUploadUrl(row.venueLogoUrl),
    recorderOnline: Boolean(row.recorderOnline),
    qrUrl: courtQrUrl(row.qrToken),
    camera: {
      configured: Boolean(cameraRtspUrl),
      // null when set but unreadable (DEVICE_SECRET_KEY changed) — re-enter it
      display: maskStreamUrl(plain),
      // PLAN-002: what the venue's recorder box receives from this camera
      live: live || null,
      // Compare with live.cameraVersion: equal → the report is about this address
      version: cameraVersion(cameraRtspUrl),
      snapshotUrl: signUploadUrl(snapshotPath),
      snapshotAt: snapshotAt || null,
      snapshotSecondsAgo: secondsSince(snapshotAt),
    },
    stream: {
      enabled: Boolean(streamEnabled),
      configured: Boolean(streamRtmpUrl),
      // The stream key is a secret: only its last 4 characters are shown
      display: maskRtmpUrl(decryptSecret(streamRtmpUrl)),
      watchUrl: streamWatchUrl || null,
    },
  };
};

/**
 * GET /
 * List courts, optionally for one venue (?venueId=)
 */
router.get(
  "/",
  checkPermission("venues", "courts", "read"),
  validateQuery(listCourtsQuerySchema),
  catchAsync(async (req, res) => {
    const {
      page = 1,
      pageSize = 10,
      search = "",
      venueId,
      status,
      sortBy = "name",
      sortOrder = "ASC",
    } = req.query;
    const offset = (page - 1) * pageSize;
    const params = [];
    let whereClause;

    if (status) {
      whereClause = "WHERE c.status = ?";
      params.push(status);
    } else {
      whereClause = "WHERE c.status != 'Deleted'";
    }
    if (venueId) {
      whereClause += " AND c.venueId = ?";
      params.push(venueId);
    }
    if (search) {
      whereClause += " AND (c.name LIKE ? OR v.name LIKE ?)";
      params.push(`%${search}%`, `%${search}%`);
    }

    const allowedSortColumns = ["dateCreated", "dateUpdated", "name"];
    const safeSortBy = allowedSortColumns.includes(sortBy) ? sortBy : "name";
    const safeSortOrder = sortOrder.toUpperCase() === "DESC" ? "DESC" : "ASC";
    const onlineSince = secondsAgoLocal(DEVICE_ONLINE_SECONDS);

    const [countRows, courts] = await Promise.all([
      req.db.query(
        `SELECT COUNT(*) as total
         FROM courts c JOIN venues v ON v.venueId = c.venueId AND v.status != 'Deleted'
         ${whereClause}`,
        params
      ),
      req.db.query(
        `${COURT_SELECT}
         ${whereClause}
         ORDER BY v.name ASC, c.${safeSortBy} ${safeSortOrder}
         LIMIT ? OFFSET ?`,
        [onlineSince, ...params, Number(pageSize), Number(offset)]
      ),
    ]);

    const total = countRows[0]?.total || 0;
    const live = await liveCameras(req.db, [...new Set(courts.map((c) => c.venueId))]);

    return res.sendSuccess("Courts retrieved successfully", {
      courts: courts.map((court) => toCourt(court, live.get(court.courtId))),
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
 * GET /options
 * Live venues for this page's venue picker and filter — under this route
 * group's own permission, so it works without the Venues permission.
 */
router.get(
  "/options",
  checkPermission("venues", "courts", "read"),
  catchAsync(async (req, res) => {
    const venues = await req.db.query(
      `SELECT venueId, name, status FROM venues WHERE status != 'Deleted' ORDER BY name ASC`
    );
    return res.sendSuccess("Venue options", { venues });
  })
);

/**
 * GET /:courtId
 */
router.get(
  "/:courtId",
  checkPermission("venues", "courts", "read"),
  catchAsync(async (req, res) => {
    const rows = await req.db.query(
      `${COURT_SELECT}
       WHERE c.courtId = ? AND c.status != 'Deleted'
       LIMIT 1`,
      [secondsAgoLocal(DEVICE_ONLINE_SECONDS), req.params.courtId]
    );

    if (rows.length === 0) {
      return res.sendError("Court not found", 404);
    }

    const live = await liveCameras(req.db, [rows[0].venueId]);
    return res.sendSuccess("Court retrieved successfully", {
      court: toCourt(rows[0], live.get(rows[0].courtId)),
    });
  })
);

/**
 * POST /
 * Court names are unique within a venue.
 */
router.post(
  "/",
  checkPermission("venues", "courts", "write"),
  validateBody(createCourtSchema),
  catchAsync(async (req, res) => {
    const {
      venueId,
      name,
      cameraRtspUrl,
      buttonCode,
      streamEnabled,
      streamRtmpUrl,
      streamWatchUrl,
    } = req.body;
    if (streamEnabled && !streamRtmpUrl) {
      return res.sendError("Enter the stream's RTMP address to turn live streaming on", 400);
    }
    const now = getCurrentTimestampLocal();

    let conn;
    try {
      conn = await req.db.beginTransaction();

      const [venue] = await conn.execute(
        `SELECT venueId FROM venues WHERE venueId = ? AND status != 'Deleted' LIMIT 1 FOR UPDATE`,
        [venueId]
      );
      if (venue.length === 0) {
        await req.db.rollback(conn);
        return res.sendError("Venue not found", 400);
      }

      const [existing] = await conn.execute(
        `SELECT courtId FROM courts
         WHERE venueId = ? AND name = ? AND status != 'Deleted'
         LIMIT 1 FOR UPDATE`,
        [venueId, name]
      );
      if (existing.length > 0) {
        await req.db.rollback(conn);
        return res.sendError("This venue already has a court with this name", 409);
      }
      if (await buttonCodeTaken(conn, buttonCode)) {
        await req.db.rollback(conn);
        return res.sendError("Another court already uses this button code", 409);
      }

      const [uuidRow] = await conn.execute(`SELECT UUID() as id`);
      const courtId = uuidRow[0].id;
      const qrToken = randomToken();

      await conn.execute(
        `INSERT INTO courts
           (courtId, venueId, name, cameraRtspUrl, qrToken, buttonCode, streamEnabled,
            streamRtmpUrl, streamWatchUrl, status, dateCreated, dateUpdated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?)`,
        [
          courtId,
          venueId,
          name,
          encryptSecret(cameraRtspUrl),
          qrToken,
          buttonCode || null,
          streamEnabled ? 1 : 0,
          encryptSecret(streamRtmpUrl),
          streamWatchUrl || null,
          now,
          now,
        ]
      );

      await req.db.commit(conn);
      return res.sendSuccess(
        "Court created successfully",
        { courtId, qrToken, qrUrl: courtQrUrl(qrToken) },
        201
      );
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }
  })
);

/**
 * PUT /:courtId
 * cameraRtspUrl: omitted/"" keeps the stored one; removeCamera clears it.
 */
router.put(
  "/:courtId",
  checkPermission("venues", "courts", "write"),
  validateBody(updateCourtSchema),
  catchAsync(async (req, res) => {
    const { courtId } = req.params;
    const {
      name,
      cameraRtspUrl,
      removeCamera,
      buttonCode,
      streamEnabled,
      streamRtmpUrl,
      removeStream,
      streamWatchUrl,
      status,
    } = req.body;
    const now = getCurrentTimestampLocal();

    let conn;
    try {
      conn = await req.db.beginTransaction();

      const [target] = await conn.execute(
        `SELECT c.courtId, c.venueId, c.cameraRtspUrl, c.streamRtmpUrl
         FROM courts c
         JOIN venues v ON v.venueId = c.venueId AND v.status != 'Deleted'
         WHERE c.courtId = ? AND c.status != 'Deleted'
         LIMIT 1 FOR UPDATE`,
        [courtId]
      );
      if (target.length === 0) {
        await req.db.rollback(conn);
        return res.sendError("Court not found", 404);
      }

      const [clash] = await conn.execute(
        `SELECT courtId FROM courts
         WHERE venueId = ? AND name = ? AND courtId != ? AND status != 'Deleted'
         LIMIT 1 FOR UPDATE`,
        [target[0].venueId, name, courtId]
      );
      if (clash.length > 0) {
        await req.db.rollback(conn);
        return res.sendError("This venue already has a court with this name", 409);
      }
      if (await buttonCodeTaken(conn, buttonCode, courtId)) {
        await req.db.rollback(conn);
        return res.sendError("Another court already uses this button code", 409);
      }

      let storedCamera = target[0].cameraRtspUrl;
      if (removeCamera) storedCamera = null;
      else if (cameraRtspUrl) storedCamera = encryptSecret(cameraRtspUrl);

      let storedStream = target[0].streamRtmpUrl;
      if (removeStream) storedStream = null;
      else if (streamRtmpUrl) storedStream = encryptSecret(streamRtmpUrl);
      if (streamEnabled && !removeStream && !storedStream) {
        await req.db.rollback(conn);
        return res.sendError("Enter the stream's RTMP address to turn live streaming on", 400);
      }

      await conn.execute(
        `UPDATE courts
         SET name = ?, cameraRtspUrl = ?, buttonCode = ?, streamEnabled = ?, streamRtmpUrl = ?,
             streamWatchUrl = ?, status = ?, dateUpdated = ?
         WHERE courtId = ?`,
        [
          name,
          storedCamera,
          buttonCode || null,
          streamEnabled && !removeStream ? 1 : 0,
          storedStream,
          streamWatchUrl || null,
          status || "Active",
          now,
          courtId,
        ]
      );

      await req.db.commit(conn);
      return res.sendSuccess("Court updated successfully");
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }
  })
);

/**
 * POST /:courtId/preview
 * The camera setup page is open: ask the venue's recorder box for a snapshot
 * every ~30 s for the next 2 minutes (the page calls this again while open).
 */
router.post(
  "/:courtId/preview",
  checkPermission("venues", "courts", "read"),
  catchAsync(async (req, res) => {
    const until = moment()
      .tz(process.env.TIMEZONE || "Asia/Manila")
      .add(2, "minutes")
      .format("YYYY-MM-DD HH:mm:ss");
    const result = await req.db.query(
      `UPDATE courts c
       JOIN venues v ON v.venueId = c.venueId AND v.status != 'Deleted'
       SET c.previewWantedUntil = ?
       WHERE c.courtId = ? AND c.status != 'Deleted'`,
      // Live status, not an edit: dateUpdated and the audit trail are left alone
      [until, req.params.courtId]
    );
    if (result.affectedRows === 0) {
      return res.sendError("Court not found", 404);
    }
    res.locals.skipAudit = true;
    return res.sendSuccess("Preview requested", { previewWantedUntil: until });
  })
);

/**
 * POST /:courtId/rotate-qr
 * Issue a new QR code. Printed signs with the old one stop working.
 */
router.post(
  "/:courtId/rotate-qr",
  checkPermission("venues", "courts", "write"),
  catchAsync(async (req, res) => {
    const { courtId } = req.params;
    const qrToken = randomToken();
    const result = await req.db.query(
      `UPDATE courts c
       JOIN venues v ON v.venueId = c.venueId AND v.status != 'Deleted'
       SET c.qrToken = ?, c.dateUpdated = ?
       WHERE c.courtId = ? AND c.status != 'Deleted'`,
      [qrToken, getCurrentTimestampLocal(), courtId]
    );

    if (result.affectedRows === 0) {
      return res.sendError("Court not found", 404);
    }

    return res.sendSuccess("New QR code issued — reprint this court's sign", {
      qrToken,
      qrUrl: courtQrUrl(qrToken),
    });
  })
);

/**
 * DELETE /:courtId — soft delete. Its QR sign stops working; clips already
 * made stay until they expire.
 */
router.delete(
  "/:courtId",
  checkPermission("venues", "courts", "write"),
  catchAsync(async (req, res) => {
    const result = await req.db.query(
      // The button code is freed so a new court can take over the button
      `UPDATE courts SET status = 'Deleted', buttonCode = NULL, dateUpdated = ?
       WHERE courtId = ? AND status != 'Deleted'`,
      [getCurrentTimestampLocal(), req.params.courtId]
    );

    if (result.affectedRows === 0) {
      return res.sendError("Court not found", 404);
    }

    return res.sendSuccess("Court deleted successfully");
  })
);

export default router;
