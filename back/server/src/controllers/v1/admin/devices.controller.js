import express from "express";
import { catchAsync, validateBody, validateQuery } from "../../../utils/catchAsync.js";
import { getCurrentTimestampLocal } from "../../../utils/dateUtils.js";
import { checkPermission } from "../../../middlewares/checkPermission.middleware.js";
import { isOnline, toEpochMs } from "../../../utils/clips.js";
import { listDevicesQuerySchema, updateDeviceSchema } from "../../../validators/devices.validator.js";

/**
 * Devices — the on-site recorder boxes (edge/) that record a venue's court
 * cameras (PLAN-001). Permission: venues / devices.
 *
 * A box is added by pairing it with a 6-digit key (pairing-codes.controller.js
 * → /api/v1/pair/device); it keeps the token it gets in DATA_DIR/device.json and
 * only its SHA-256 is stored here. Revoking a box stops it at its next request.
 */
const router = express.Router();

const DEVICE_SELECT = `
  SELECT d.deviceId, d.venueId, v.name AS venueName, d.name, d.status, d.lastSeenAt,
         d.agentVersion, d.lastStatus, d.dateCreated, d.dateUpdated
  FROM devices d
  JOIN venues v ON v.venueId = d.venueId AND v.status != 'Deleted'`;

/** mysql2 usually parses JSON columns already; accept a string too. */
const parseJson = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const toDevice = (row) => {
  const lastStatus = parseJson(row.lastStatus);
  return {
    ...row,
    online: row.status === "Active" && isOnline(row.lastSeenAt),
    // Relative to now on the server, so "last seen 2 min ago" is right in any
    // browser time zone (timestamps are Manila local, with no zone attached)
    lastSeenSecondsAgo: row.lastSeenAt
      ? Math.max(0, Math.round((Date.now() - toEpochMs(row.lastSeenAt)) / 1000))
      : null,
    cameras: Array.isArray(lastStatus?.cameras) ? lastStatus.cameras : [],
    lastStatus: undefined,
  };
};

/**
 * GET /
 */
router.get(
  "/",
  checkPermission("venues", "devices", "read"),
  validateQuery(listDevicesQuerySchema),
  catchAsync(async (req, res) => {
    const {
      page = 1,
      pageSize = 10,
      search = "",
      venueId,
      status,
      sortBy = "dateCreated",
      sortOrder = "DESC",
    } = req.query;
    const offset = (page - 1) * pageSize;
    const params = [];
    let whereClause;

    if (status) {
      whereClause = "WHERE d.status = ?";
      params.push(status);
    } else {
      whereClause = "WHERE d.status != 'Deleted'";
    }
    if (venueId) {
      whereClause += " AND d.venueId = ?";
      params.push(venueId);
    }
    if (search) {
      whereClause += " AND (d.name LIKE ? OR v.name LIKE ?)";
      params.push(`%${search}%`, `%${search}%`);
    }

    const allowedSortColumns = ["dateCreated", "name", "lastSeenAt"];
    const safeSortBy = allowedSortColumns.includes(sortBy) ? sortBy : "dateCreated";
    const safeSortOrder = sortOrder.toUpperCase() === "ASC" ? "ASC" : "DESC";

    const [countRows, devices] = await Promise.all([
      req.db.query(
        `SELECT COUNT(*) as total
         FROM devices d JOIN venues v ON v.venueId = d.venueId AND v.status != 'Deleted'
         ${whereClause}`,
        params
      ),
      req.db.query(
        `${DEVICE_SELECT}
         ${whereClause}
         ORDER BY d.${safeSortBy} ${safeSortOrder}
         LIMIT ? OFFSET ?`,
        [...params, Number(pageSize), Number(offset)]
      ),
    ]);

    const total = countRows[0]?.total || 0;

    return res.sendSuccess("Recorder boxes retrieved successfully", {
      devices: devices.map(toDevice),
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
  checkPermission("venues", "devices", "read"),
  catchAsync(async (req, res) => {
    const venues = await req.db.query(
      `SELECT venueId, name, status FROM venues WHERE status != 'Deleted' ORDER BY name ASC`
    );
    return res.sendSuccess("Venue options", { venues });
  })
);

/**
 * GET /:deviceId
 */
router.get(
  "/:deviceId",
  checkPermission("venues", "devices", "read"),
  catchAsync(async (req, res) => {
    const rows = await req.db.query(
      `${DEVICE_SELECT}
       WHERE d.deviceId = ? AND d.status != 'Deleted'
       LIMIT 1`,
      [req.params.deviceId]
    );

    if (rows.length === 0) {
      return res.sendError("Recorder box not found", 404);
    }

    return res.sendSuccess("Recorder box retrieved successfully", { device: toDevice(rows[0]) });
  })
);

/**
 * PUT /:deviceId — rename
 */
router.put(
  "/:deviceId",
  checkPermission("venues", "devices", "write"),
  validateBody(updateDeviceSchema),
  catchAsync(async (req, res) => {
    const result = await req.db.query(
      `UPDATE devices SET name = ?, dateUpdated = ?
       WHERE deviceId = ? AND status != 'Deleted'`,
      [req.body.name, getCurrentTimestampLocal(), req.params.deviceId]
    );

    if (result.affectedRows === 0) {
      return res.sendError("Recorder box not found", 404);
    }

    return res.sendSuccess("Recorder box updated successfully");
  })
);

/**
 * POST /:deviceId/revoke
 * The box is refused from its next request; to use it again, pair it with a new
 * key (Add box), which adds it as a new box.
 */
router.post(
  "/:deviceId/revoke",
  checkPermission("venues", "devices", "write"),
  catchAsync(async (req, res) => {
    const result = await req.db.query(
      `UPDATE devices SET status = 'Revoked', dateUpdated = ?
       WHERE deviceId = ? AND status = 'Active'`,
      [getCurrentTimestampLocal(), req.params.deviceId]
    );

    if (result.affectedRows === 0) {
      return res.sendError("Recorder box not found", 404);
    }

    return res.sendSuccess("Recorder box revoked");
  })
);

/**
 * DELETE /:deviceId — soft delete (also stops the box)
 */
router.delete(
  "/:deviceId",
  checkPermission("venues", "devices", "write"),
  catchAsync(async (req, res) => {
    const result = await req.db.query(
      `UPDATE devices SET status = 'Deleted', dateUpdated = ?
       WHERE deviceId = ? AND status != 'Deleted'`,
      [getCurrentTimestampLocal(), req.params.deviceId]
    );

    if (result.affectedRows === 0) {
      return res.sendError("Recorder box not found", 404);
    }

    return res.sendSuccess("Recorder box deleted successfully");
  })
);

export default router;
