import express from "express";
import { catchAsync, validateBody, validateQuery } from "../../../utils/catchAsync.js";
import { getCurrentTimestampLocal } from "../../../utils/dateUtils.js";
import { checkPermission } from "../../../middlewares/checkPermission.middleware.js";
import { courtQrUrl, DEVICE_ONLINE_SECONDS, secondsAgoLocal } from "../../../utils/clips.js";
import { decryptSecret, encryptSecret, maskStreamUrl } from "../../../utils/crypto/secretBox.js";
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
         c.cameraRtspUrl, c.qrToken, c.buttonCode,
         c.status, c.dateCreated, c.dateUpdated,
         EXISTS (
           SELECT 1 FROM devices d
           WHERE d.venueId = c.venueId AND d.status = 'Active' AND d.lastSeenAt >= ?
         ) AS recorderOnline
  FROM courts c
  JOIN venues v ON v.venueId = c.venueId AND v.status != 'Deleted'`;

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

const toCourt = (row) => {
  const { cameraRtspUrl, ...court } = row;
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

    return res.sendSuccess("Courts retrieved successfully", {
      courts: courts.map(toCourt),
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

    return res.sendSuccess("Court retrieved successfully", { court: toCourt(rows[0]) });
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
    const { venueId, name, cameraRtspUrl, buttonCode } = req.body;
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
           (courtId, venueId, name, cameraRtspUrl, qrToken, buttonCode, status, dateCreated,
            dateUpdated)
         VALUES (?, ?, ?, ?, ?, ?, 'Active', ?, ?)`,
        [
          courtId,
          venueId,
          name,
          encryptSecret(cameraRtspUrl),
          qrToken,
          buttonCode || null,
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
    const { name, cameraRtspUrl, removeCamera, buttonCode, status } = req.body;
    const now = getCurrentTimestampLocal();

    let conn;
    try {
      conn = await req.db.beginTransaction();

      const [target] = await conn.execute(
        `SELECT c.courtId, c.venueId, c.cameraRtspUrl
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

      await conn.execute(
        `UPDATE courts SET name = ?, cameraRtspUrl = ?, buttonCode = ?, status = ?, dateUpdated = ?
         WHERE courtId = ?`,
        [name, storedCamera, buttonCode || null, status || "Active", now, courtId]
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
