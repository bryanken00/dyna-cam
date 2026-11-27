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
  COURT_DRIVE_COLUMNS,
  disconnectCourtDrive,
  driveQueue,
  driveSummary,
} from "../../../utils/courtDrive.js";
import { consentUrl, driveConfigured, signDriveState } from "../../../utils/googleDrive.js";
import APIError, { ERROR_CODES } from "../../../utils/APIError.js";
import { callerCompany, courtInCompany } from "../../../utils/companyScope.js";
import {
  createCourtSchema,
  listCourtsQuerySchema,
  updateCourtSchema,
} from "../../../validators/courts.validator.js";

/**
 * Courts — one camera each, inside a venue (PLAN-001).
 * Permission: venues / courts. PLAN-008: only courts at the caller's company's
 * venues — another company's court (or venue) is a 404.
 *
 * The camera URL is write-only here: it carries the camera's credentials, so
 * responses only say whether one is set and show it with the credentials
 * removed. The plaintext goes only to the venue's own recorder box.
 */
const router = express.Router();

const COURT_SELECT = `
  SELECT c.courtId, c.venueId, v.name AS venueName, v.logoUrl AS venueLogoUrl, c.name,
         c.cameraRtspUrl, c.camera2RtspUrl, c.qrToken, c.streamEnabled,
         c.streamRtmpUrl, c.streamWatchUrl, c.streamLayout, c.snapshotPath, c.snapshotAt,
         c.surface, c.isIndoor,
         c.snapshot2Path, c.snapshot2At, ${COURT_DRIVE_COLUMNS("c")},
         c.status, c.dateCreated, c.dateUpdated,
         EXISTS (
           SELECT 1 FROM devices d
           WHERE d.venueId = c.venueId AND d.status = 'Active' AND d.lastSeenAt >= ?
         ) AS recorderOnline
  FROM courts c
  JOIN venues v ON v.venueId = c.venueId AND v.status != 'Deleted' AND v.companyId = ?`;

/** Seconds since a stored Manila timestamp, by the server's clock (null if none). */
const secondsSince = (localTimestamp) =>
  localTimestamp ? Math.max(0, Math.round((Date.now() - toEpochMs(localTimestamp)) / 1000)) : null;

/**
 * What each court's camera looks like to its venue's recorder box right now
 * (PLAN-002 camera setup): the latest heartbeat entry for the court, from the
 * most recently seen Active box of the venue. Phase H: keyed by court and
 * camera (`liveKey(courtId, 2)`); a report without `camera` is camera 1.
 * @returns {Promise<Map<string, Object>>} liveKey → live camera info
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
      live.set(liveKey(camera.courtId, camera.camera || 1), {
        status: camera.status,
        message: camera.message || null,
        // The venue's court stream (reported on camera 1's entry): off/starting/live/error
        streamStatus: camera.streamStatus || null,
        streamMessage: camera.streamMessage || null,
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

const liveKey = (courtId, camera = 1) => `${courtId}#${camera}`;

/**
 * Camera 2 needs camera 1, and a layout showing camera 2 needs camera 2.
 * @returns {string|null} the problem, for a 400
 */
const cameraProblem = ({ camera1, camera2, layout }) => {
  if (camera2 && !camera1) return "Set up camera 1 before adding a second camera";
  if (!camera2 && layout && layout !== "CAM1") {
    return "Cam 2 and Both need a second camera on this court";
  }
  return null;
};

/** One camera as the court setup page shows it (camera 1 or camera 2). */
const toCamera = (stored, live, snapshotPath, snapshotAt) => ({
  configured: Boolean(stored),
  // null when set but unreadable (DEVICE_SECRET_KEY changed) — re-enter it
  display: maskStreamUrl(decryptSecret(stored)),
  // PLAN-002: what the venue's recorder box receives from this camera
  live: live || null,
  // Compare with live.cameraVersion: equal → the report is about this address
  version: cameraVersion(stored),
  snapshotUrl: signUploadUrl(snapshotPath),
  snapshotAt: snapshotAt || null,
  snapshotSecondsAgo: secondsSince(snapshotAt),
});

/** PLAN-009 phase B: isIndoor from a body (true / false / null / omitted) → the column's 1 / 0 / NULL. */
const indoorValue = (value) => (value === undefined || value === null ? null : value ? 1 : 0);

/** On an edit: an omitted surface / isIndoor keeps the stored value, "" / null clears it. */
const courtFacts = ({ surface, isIndoor }, stored) => ({
  surface: surface === undefined ? stored.surface : surface || null,
  isIndoor: isIndoor === undefined ? stored.isIndoor : indoorValue(isIndoor),
});

const toCourt = (row, live = new Map(), queue = null) => {
  const {
    cameraRtspUrl,
    camera2RtspUrl,
    streamRtmpUrl,
    streamEnabled,
    streamWatchUrl,
    streamLayout,
    snapshotPath,
    snapshotAt,
    snapshot2Path,
    snapshot2At,
    driveRefreshToken: _driveRefreshToken,
    driveEmail: _driveEmail,
    driveStatus: _driveStatus,
    driveProblem: _driveProblem,
    driveConnectedAt: _driveConnectedAt,
    ...court
  } = row;
  return {
    ...court,
    venueLogoUrl: signUploadUrl(row.venueLogoUrl),
    recorderOnline: Boolean(row.recorderOnline),
    // PLAN-009 phase B: null = not said
    isIndoor: row.isIndoor === null || row.isIndoor === undefined ? null : Boolean(row.isIndoor),
    // The court's QR sign — CR-027: players start their own game there
    qrUrl: courtQrUrl(row.qrToken),
    camera: toCamera(cameraRtspUrl, live.get(liveKey(row.courtId, 1)), snapshotPath, snapshotAt),
    // PLAN-002 Phase H: the optional second camera
    camera2: toCamera(
      camera2RtspUrl,
      live.get(liveKey(row.courtId, 2)),
      snapshot2Path,
      snapshot2At
    ),
    // What the venue's court stream shows (CAM1 / CAM2 / STACKED)
    streamLayout: camera2RtspUrl ? streamLayout : "CAM1",
    stream: {
      enabled: Boolean(streamEnabled),
      configured: Boolean(streamRtmpUrl),
      // The stream key is a secret: only its last 4 characters are shown
      display: maskRtmpUrl(decryptSecret(streamRtmpUrl)),
      watchUrl: streamWatchUrl || null,
    },
    // CR-001: the court's Google Drive (the token itself is never returned)
    googleDrive: driveSummary(row, queue),
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
         FROM courts c
         JOIN venues v ON v.venueId = c.venueId AND v.status != 'Deleted' AND v.companyId = ?
         ${whereClause}`,
        [callerCompany(req), ...params]
      ),
      req.db.query(
        `${COURT_SELECT}
         ${whereClause}
         ORDER BY v.name ASC, c.${safeSortBy} ${safeSortOrder}
         LIMIT ? OFFSET ?`,
        [onlineSince, callerCompany(req), ...params, Number(pageSize), Number(offset)]
      ),
    ]);

    const total = countRows[0]?.total || 0;
    const live = await liveCameras(req.db, [...new Set(courts.map((c) => c.venueId))]);

    return res.sendSuccess("Courts retrieved successfully", {
      courts: courts.map((court) => toCourt(court, live)),
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
      `SELECT venueId, name, status FROM venues
       WHERE status != 'Deleted' AND companyId = ? ORDER BY name ASC`,
      [callerCompany(req)]
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
      [secondsAgoLocal(DEVICE_ONLINE_SECONDS), callerCompany(req), req.params.courtId]
    );

    if (rows.length === 0) {
      return res.sendError("Court not found", 404);
    }

    const live = await liveCameras(req.db, [rows[0].venueId]);
    const queue = rows[0].driveRefreshToken ? await driveQueue(req.db, req.params.courtId) : null;
    return res.sendSuccess("Court retrieved successfully", {
      court: toCourt(rows[0], live, queue),
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
      camera2RtspUrl,
      streamEnabled,
      streamRtmpUrl,
      streamWatchUrl,
      streamLayout = "CAM1",
      surface,
      isIndoor,
    } = req.body;
    if (streamEnabled && !streamRtmpUrl) {
      return res.sendError("Enter the stream's RTMP address to turn live streaming on", 400);
    }
    const layoutProblem = cameraProblem({
      camera1: cameraRtspUrl,
      camera2: camera2RtspUrl,
      layout: streamLayout,
    });
    if (layoutProblem) return res.sendError(layoutProblem, 400);
    const now = getCurrentTimestampLocal();

    let conn;
    try {
      conn = await req.db.beginTransaction();

      const [venue] = await conn.execute(
        `SELECT venueId FROM venues
         WHERE venueId = ? AND companyId = ? AND status != 'Deleted' LIMIT 1 FOR UPDATE`,
        [venueId, callerCompany(req)]
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

      const [uuidRow] = await conn.execute(`SELECT UUID() as id`);
      const courtId = uuidRow[0].id;
      const qrToken = randomToken();

      await conn.execute(
        `INSERT INTO courts
           (courtId, venueId, name, cameraRtspUrl, camera2RtspUrl, qrToken,
            streamEnabled, streamRtmpUrl, streamWatchUrl, streamLayout, surface, isIndoor, status,
            dateCreated, dateUpdated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?)`,
        [
          courtId,
          venueId,
          name,
          encryptSecret(cameraRtspUrl),
          encryptSecret(camera2RtspUrl),
          qrToken,
          streamEnabled ? 1 : 0,
          encryptSecret(streamRtmpUrl),
          streamWatchUrl || null,
          streamLayout,
          surface || null,
          indoorValue(isIndoor),
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
 * cameraRtspUrl / camera2RtspUrl: omitted/"" keeps the stored one;
 * removeCamera / removeCamera2 clears it. streamLayout: omitted keeps it.
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
      camera2RtspUrl,
      removeCamera2,
      streamEnabled,
      streamRtmpUrl,
      removeStream,
      streamWatchUrl,
      streamLayout,
      status,
    } = req.body;
    const now = getCurrentTimestampLocal();

    let conn;
    try {
      conn = await req.db.beginTransaction();

      const [target] = await conn.execute(
        `SELECT c.courtId, c.venueId, c.cameraRtspUrl, c.camera2RtspUrl, c.streamRtmpUrl,
                c.streamLayout, c.surface, c.isIndoor
         FROM courts c
         JOIN venues v ON v.venueId = c.venueId AND v.status != 'Deleted' AND v.companyId = ?
         WHERE c.courtId = ? AND c.status != 'Deleted'
         LIMIT 1 FOR UPDATE`,
        [callerCompany(req), courtId]
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

      let storedCamera = target[0].cameraRtspUrl;
      if (removeCamera) storedCamera = null;
      else if (cameraRtspUrl) storedCamera = encryptSecret(cameraRtspUrl);

      let storedCamera2 = target[0].camera2RtspUrl;
      if (removeCamera2) storedCamera2 = null;
      else if (camera2RtspUrl) storedCamera2 = encryptSecret(camera2RtspUrl);

      // Removing camera 2 drops a layout that needs it; an explicit one is checked
      let layout = streamLayout ?? target[0].streamLayout;
      if (!storedCamera2 && streamLayout === undefined) layout = "CAM1";
      const layoutProblem = cameraProblem({
        camera1: storedCamera,
        camera2: storedCamera2,
        layout,
      });
      if (layoutProblem) {
        await req.db.rollback(conn);
        return res.sendError(layoutProblem, 400);
      }

      let storedStream = target[0].streamRtmpUrl;
      if (removeStream) storedStream = null;
      else if (streamRtmpUrl) storedStream = encryptSecret(streamRtmpUrl);
      if (streamEnabled && !removeStream && !storedStream) {
        await req.db.rollback(conn);
        return res.sendError("Enter the stream's RTMP address to turn live streaming on", 400);
      }

      const facts = courtFacts(req.body, target[0]);
      await conn.execute(
        `UPDATE courts
         SET name = ?, cameraRtspUrl = ?, camera2RtspUrl = ?, streamEnabled = ?,
             streamRtmpUrl = ?, streamWatchUrl = ?, streamLayout = ?, surface = ?, isIndoor = ?,
             status = ?, dateUpdated = ?
         WHERE courtId = ?`,
        [
          name,
          storedCamera,
          storedCamera2,
          streamEnabled && !removeStream ? 1 : 0,
          storedStream,
          streamWatchUrl || null,
          layout,
          facts.surface,
          facts.isIndoor,
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
       JOIN venues v ON v.venueId = c.venueId AND v.status != 'Deleted' AND v.companyId = ?
       SET c.previewWantedUntil = ?
       WHERE c.courtId = ? AND c.status != 'Deleted'`,
      // Live status, not an edit: dateUpdated and the audit trail are left alone
      [callerCompany(req), until, req.params.courtId]
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
       JOIN venues v ON v.venueId = c.venueId AND v.status != 'Deleted' AND v.companyId = ?
       SET c.qrToken = ?, c.dateUpdated = ?
       WHERE c.courtId = ? AND c.status != 'Deleted'`,
      [callerCompany(req), qrToken, getCurrentTimestampLocal(), courtId]
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
 * POST /:courtId/google-drive/connect  (CR-001)
 * Start connecting (or changing) the court's Google account: returns Google's
 * consent screen URL. Google sends the browser back to
 * GET /api/v1/oauth/google/callback, which stores the sign-in and returns to
 * the court setup page.
 */
router.post(
  "/:courtId/google-drive/connect",
  checkPermission("venues", "courts", "write"),
  catchAsync(async (req, res) => {
    if (!driveConfigured()) {
      throw new APIError(
        "Google Drive isn't set up on this server yet",
        409,
        ERROR_CODES.INVALID_STATUS
      );
    }
    const rows = await req.db.query(
      `SELECT c.courtId, c.venueId FROM courts c
       JOIN venues v ON v.venueId = c.venueId AND v.status != 'Deleted' AND v.companyId = ?
       WHERE c.courtId = ? AND c.status != 'Deleted'
       LIMIT 1`,
      [callerCompany(req), req.params.courtId]
    );
    if (rows.length === 0) {
      return res.sendError("Court not found", 404);
    }
    const state = signDriveState({
      courtId: rows[0].courtId,
      venueId: rows[0].venueId,
      accountId: req.user.accountId,
    });
    // Nothing changes until Google sends the sign-in back
    res.locals.skipAudit = true;
    return res.sendSuccess("Continue on Google", { url: consentUrl(state) });
  })
);

/**
 * DELETE /:courtId/google-drive  (CR-001)
 * Disconnect the court's Google account. New recordings stay on the server
 * only; files already in the Drive stay there.
 */
router.delete(
  "/:courtId/google-drive",
  checkPermission("venues", "courts", "write"),
  catchAsync(async (req, res) => {
    if (!(await courtInCompany(req.db, req.params.courtId, callerCompany(req)))) {
      return res.sendError("Court not found", 404);
    }
    const found = await disconnectCourtDrive(req.db, req.params.courtId);
    if (!found) {
      return res.sendError("Court not found", 404);
    }
    return res.sendSuccess("Google Drive disconnected");
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
      `UPDATE courts c
       JOIN venues v ON v.venueId = c.venueId AND v.companyId = ?
       SET c.status = 'Deleted', c.dateUpdated = ?
       WHERE c.courtId = ? AND c.status != 'Deleted'`,
      [callerCompany(req), getCurrentTimestampLocal(), req.params.courtId]
    );

    if (result.affectedRows === 0) {
      return res.sendError("Court not found", 404);
    }

    return res.sendSuccess("Court deleted successfully");
  })
);

export default router;
