import express from "express";
import { catchAsync, validateBody, validateQuery } from "../../../utils/catchAsync.js";
import { getCurrentTimestampLocal } from "../../../utils/dateUtils.js";
import { checkPermission } from "../../../middlewares/checkPermission.middleware.js";
import { toEpochMs } from "../../../utils/clips.js";
import {
  listPairedAppsQuerySchema,
  updatePairedAppSchema,
} from "../../../validators/pairing.validator.js";

/**
 * Paired staff phones (PLAN-002). Permission: paired_apps.
 * A phone pairs itself with a 6-digit key (see pairing-codes.controller.js);
 * here staff see, rename, revoke and delete them. A revoked phone gets 401 at
 * its next request and shows "This phone was unpaired".
 */
const router = express.Router();

const SELECT = `
  SELECT pa.pairedAppId, pa.venueId, v.name AS venueName, pa.name, pa.platform, pa.appVersion,
         pa.lastSeenAt, pa.status, pa.dateCreated, pa.dateUpdated
  FROM paired_apps pa
  JOIN venues v ON v.venueId = pa.venueId AND v.status != 'Deleted'`;

const toPairedApp = (row) => ({
  ...row,
  lastSeenSecondsAgo: row.lastSeenAt
    ? Math.max(0, Math.round((Date.now() - toEpochMs(row.lastSeenAt)) / 1000))
    : null,
});

/**
 * GET /
 */
router.get(
  "/",
  checkPermission("paired_apps", null, "read"),
  validateQuery(listPairedAppsQuerySchema),
  catchAsync(async (req, res) => {
    const { page = 1, pageSize = 20, venueId, status } = req.query;
    const offset = (page - 1) * pageSize;
    const params = [];
    let whereClause;
    if (status) {
      whereClause = "WHERE pa.status = ?";
      params.push(status);
    } else {
      whereClause = "WHERE pa.status != 'Deleted'";
    }
    if (venueId) {
      whereClause += " AND pa.venueId = ?";
      params.push(venueId);
    }

    const [countRows, rows] = await Promise.all([
      req.db.query(
        `SELECT COUNT(*) AS total FROM paired_apps pa
         JOIN venues v ON v.venueId = pa.venueId AND v.status != 'Deleted'
         ${whereClause}`,
        params
      ),
      req.db.query(`${SELECT} ${whereClause} ORDER BY pa.dateCreated DESC LIMIT ? OFFSET ?`, [
        ...params,
        Number(pageSize),
        Number(offset),
      ]),
    ]);
    const total = countRows[0]?.total || 0;
    return res.sendSuccess("Paired phones retrieved successfully", {
      pairedApps: rows.map(toPairedApp),
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
 * GET /options — venues for the "Pair a phone" picker and the filter
 */
router.get(
  "/options",
  checkPermission("paired_apps", null, "read"),
  catchAsync(async (req, res) => {
    const venues = await req.db.query(
      `SELECT venueId, name, status FROM venues WHERE status != 'Deleted' ORDER BY name ASC`
    );
    return res.sendSuccess("Paired phone options", { venues });
  })
);

/**
 * GET /:pairedAppId
 */
router.get(
  "/:pairedAppId",
  checkPermission("paired_apps", null, "read"),
  catchAsync(async (req, res) => {
    const rows = await req.db.query(
      `${SELECT} WHERE pa.pairedAppId = ? AND pa.status != 'Deleted' LIMIT 1`,
      [req.params.pairedAppId]
    );
    if (rows.length === 0) {
      return res.sendError("Paired phone not found", 404);
    }
    return res.sendSuccess("Paired phone retrieved successfully", {
      pairedApp: toPairedApp(rows[0]),
    });
  })
);

/**
 * PUT /:pairedAppId — rename
 */
router.put(
  "/:pairedAppId",
  checkPermission("paired_apps", null, "write"),
  validateBody(updatePairedAppSchema),
  catchAsync(async (req, res) => {
    const result = await req.db.query(
      `UPDATE paired_apps SET name = ?, dateUpdated = ?
       WHERE pairedAppId = ? AND status != 'Deleted'`,
      [req.body.name, getCurrentTimestampLocal(), req.params.pairedAppId]
    );
    if (result.affectedRows === 0) {
      return res.sendError("Paired phone not found", 404);
    }
    return res.sendSuccess("Paired phone renamed");
  })
);

/**
 * POST /:pairedAppId/revoke — unpair it at its next request
 */
router.post(
  "/:pairedAppId/revoke",
  checkPermission("paired_apps", null, "write"),
  catchAsync(async (req, res) => {
    const result = await req.db.query(
      `UPDATE paired_apps SET status = 'Revoked', dateUpdated = ?
       WHERE pairedAppId = ? AND status = 'Active'`,
      [getCurrentTimestampLocal(), req.params.pairedAppId]
    );
    if (result.affectedRows === 0) {
      return res.sendError("Paired phone not found", 404);
    }
    return res.sendSuccess("Phone unpaired");
  })
);

/**
 * DELETE /:pairedAppId — soft delete (also unpairs it)
 */
router.delete(
  "/:pairedAppId",
  checkPermission("paired_apps", null, "write"),
  catchAsync(async (req, res) => {
    const result = await req.db.query(
      `UPDATE paired_apps SET status = 'Deleted', dateUpdated = ?
       WHERE pairedAppId = ? AND status != 'Deleted'`,
      [getCurrentTimestampLocal(), req.params.pairedAppId]
    );
    if (result.affectedRows === 0) {
      return res.sendError("Paired phone not found", 404);
    }
    return res.sendSuccess("Paired phone deleted");
  })
);

export default router;
