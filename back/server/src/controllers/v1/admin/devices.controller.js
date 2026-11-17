import express from "express";
import { catchAsync, validateBody, validateQuery } from "../../../utils/catchAsync.js";
import { getCurrentTimestampLocal } from "../../../utils/dateUtils.js";
import { checkPermission } from "../../../middlewares/checkPermission.middleware.js";
import { isOnline } from "../../../utils/clips.js";
import { hashToken, randomToken } from "../../../utils/crypto/tokens.js";
import {
  createDeviceSchema,
  listDevicesQuerySchema,
  updateDeviceSchema,
} from "../../../validators/devices.validator.js";

/**
 * Devices — the on-site recorder boxes (edge/) that record a venue's court
 * cameras (PLAN-001). Permission: venues / devices.
 *
 * A box signs in with a token shown once, when it is added (or re-issued);
 * only its SHA-256 is stored. Revoking a box stops it at its next request.
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
    cameras: Array.isArray(lastStatus?.cameras) ? lastStatus.cameras : [],
    lastStatus: undefined,
  };
};

/** The credential a box is configured with. Shown once. */
const newDeviceToken = () => `dcb_${randomToken(32)}`;

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
 * POST /
 * Returns the box's token — the only time it is ever shown.
 */
router.post(
  "/",
  checkPermission("venues", "devices", "write"),
  validateBody(createDeviceSchema),
  catchAsync(async (req, res) => {
    const { venueId, name } = req.body;
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

      const [uuidRow] = await conn.execute(`SELECT UUID() as id`);
      const deviceId = uuidRow[0].id;
      const token = newDeviceToken();

      await conn.execute(
        `INSERT INTO devices (deviceId, venueId, name, tokenHash, status, dateCreated, dateUpdated)
         VALUES (?, ?, ?, ?, 'Active', ?, ?)`,
        [deviceId, venueId, name, hashToken(token), now, now]
      );

      await req.db.commit(conn);
      return res.sendSuccess(
        "Recorder box added — copy its token now, it will not be shown again",
        { deviceId, token },
        201
      );
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }
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
 * POST /:deviceId/token
 * Issue a new token (e.g. the box was reinstalled) and re-activate a revoked
 * box. The old token stops working immediately.
 */
router.post(
  "/:deviceId/token",
  checkPermission("venues", "devices", "write"),
  catchAsync(async (req, res) => {
    const token = newDeviceToken();
    const result = await req.db.query(
      `UPDATE devices d
       JOIN venues v ON v.venueId = d.venueId AND v.status != 'Deleted'
       SET d.tokenHash = ?, d.status = 'Active', d.dateUpdated = ?
       WHERE d.deviceId = ? AND d.status != 'Deleted'`,
      [hashToken(token), getCurrentTimestampLocal(), req.params.deviceId]
    );

    if (result.affectedRows === 0) {
      return res.sendError("Recorder box not found", 404);
    }

    return res.sendSuccess("New token issued — copy it now, it will not be shown again", {
      deviceId: req.params.deviceId,
      token,
    });
  })
);

/**
 * POST /:deviceId/revoke
 * The box is refused from its next request until a new token is issued.
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
