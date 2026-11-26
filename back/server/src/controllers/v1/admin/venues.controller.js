import express from "express";
import { catchAsync, validateBody, validateQuery } from "../../../utils/catchAsync.js";
import { getCurrentTimestampLocal } from "../../../utils/dateUtils.js";
import APIError, { ERROR_CODES } from "../../../utils/APIError.js";
import { canAccessUpload } from "../../../utils/file/uploads.js";
import { signUploadUrl } from "../../../utils/file/signedUrl.js";
import { checkPermission } from "../../../middlewares/checkPermission.middleware.js";
import { callerCompany } from "../../../utils/companyScope.js";
import {
  createVenueSchema,
  listVenuesQuerySchema,
  updateVenueSchema,
} from "../../../validators/venues.validator.js";

/**
 * Venues — pickleball venues that host Dyna Cam courts (PLAN-001).
 * Permission: venues / list. PLAN-008: only the caller's company's venues — another
 * company's venue is a 404; names are unique within a company.
 */
const router = express.Router();

const VENUE_COLUMNS = `v.venueId, v.name, v.address, v.regionCode, v.provinceCode, v.cityMunCode,
  v.barangayCode, v.street, v.latitude, v.longitude, v.phone, v.logoUrl, v.clipRetentionDays,
  v.clipPrice, v.status, v.dateCreated, v.dateUpdated`;

// Courts and recorder boxes per venue, for the list and the detail view
const COUNT_COLUMNS = `
  (SELECT COUNT(*) FROM courts c WHERE c.venueId = v.venueId AND c.status != 'Deleted') AS courtCount,
  (SELECT COUNT(*) FROM devices d WHERE d.venueId = v.venueId AND d.status = 'Active') AS deviceCount`;

const toVenue = (row) => ({
  ...row,
  clipPrice: Number(row.clipPrice),
  logoUrl: signUploadUrl(row.logoUrl),
  // CR-050: the map pin (DECIMAL → number; null = no pin)
  latitude: row.latitude === null || row.latitude === undefined ? null : Number(row.latitude),
  longitude: row.longitude === null || row.longitude === undefined ? null : Number(row.longitude),
});

/** CR-050: the location columns from a validated body, in LOCATION_COLUMNS order. */
const LOCATION_COLUMNS = ["regionCode", "provinceCode", "cityMunCode", "barangayCode", "street", "latitude", "longitude"];
const locationValues = (body) => LOCATION_COLUMNS.map((key) => (body[key] === undefined ? null : body[key]));

/** A client-sent logo path must be one the caller may use (see file-uploads.md). */
const assertLogo = (req, logoUrl) => {
  if (logoUrl && !canAccessUpload(req.user, logoUrl)) {
    throw new APIError("Invalid logo image", 400, ERROR_CODES.VALIDATION_FAILED);
  }
};

/**
 * GET /
 * List venues
 */
router.get(
  "/",
  checkPermission("venues", "list", "read"),
  validateQuery(listVenuesQuerySchema),
  catchAsync(async (req, res) => {
    const {
      page = 1,
      pageSize = 10,
      search = "",
      status,
      sortBy = "dateCreated",
      sortOrder = "DESC",
    } = req.query;
    const offset = (page - 1) * pageSize;
    const params = [callerCompany(req)];
    let whereClause = "WHERE v.companyId = ?";

    // No status filter → hide soft-deleted. Explicit ?status=Deleted → show them.
    if (status) {
      whereClause += " AND v.status = ?";
      params.push(status);
    } else {
      whereClause += " AND v.status != 'Deleted'";
    }

    if (search) {
      whereClause += " AND (v.name LIKE ? OR v.address LIKE ?)";
      params.push(`%${search}%`, `%${search}%`);
    }

    // Whitelist the sort column — it is interpolated, not bound.
    const allowedSortColumns = ["dateCreated", "dateUpdated", "name"];
    const safeSortBy = allowedSortColumns.includes(sortBy) ? sortBy : "dateCreated";
    const safeSortOrder = sortOrder.toUpperCase() === "ASC" ? "ASC" : "DESC";

    const [countRows, venues] = await Promise.all([
      req.db.query(`SELECT COUNT(*) as total FROM venues v ${whereClause}`, params),
      req.db.query(
        `SELECT ${VENUE_COLUMNS}, ${COUNT_COLUMNS}
         FROM venues v
         ${whereClause}
         ORDER BY v.${safeSortBy} ${safeSortOrder}
         LIMIT ? OFFSET ?`,
        [...params, Number(pageSize), Number(offset)]
      ),
    ]);

    const total = countRows[0]?.total || 0;

    return res.sendSuccess("Venues retrieved successfully", {
      venues: venues.map(toVenue),
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
 * GET /:venueId
 */
router.get(
  "/:venueId",
  checkPermission("venues", "list", "read"),
  catchAsync(async (req, res) => {
    const rows = await req.db.query(
      `SELECT ${VENUE_COLUMNS}, ${COUNT_COLUMNS}
       FROM venues v
       WHERE v.venueId = ? AND v.companyId = ? AND v.status != 'Deleted'
       LIMIT 1`,
      [req.params.venueId, callerCompany(req)]
    );

    if (rows.length === 0) {
      return res.sendError("Venue not found", 404);
    }

    return res.sendSuccess("Venue retrieved successfully", { venue: toVenue(rows[0]) });
  })
);

/**
 * POST /
 * Venue names are unique among live venues — check and insert in one
 * transaction with FOR UPDATE.
 */
router.post(
  "/",
  checkPermission("venues", "list", "write"),
  validateBody(createVenueSchema),
  catchAsync(async (req, res) => {
    const { name, address, phone, logoUrl, clipRetentionDays, clipPrice } = req.body;
    assertLogo(req, logoUrl);
    const now = getCurrentTimestampLocal();

    let conn;
    try {
      conn = await req.db.beginTransaction();

      const [existing] = await conn.execute(
        `SELECT venueId FROM venues
         WHERE name = ? AND companyId = ? AND status != 'Deleted' LIMIT 1 FOR UPDATE`,
        [name, callerCompany(req)]
      );
      if (existing.length > 0) {
        await req.db.rollback(conn);
        return res.sendError("A venue with this name already exists", 409);
      }

      const [uuidRow] = await conn.execute(`SELECT UUID() as id`);
      const venueId = uuidRow[0].id;

      await conn.execute(
        `INSERT INTO venues
           (venueId, companyId, name, address, ${LOCATION_COLUMNS.join(", ")}, phone, logoUrl,
            clipRetentionDays, clipPrice, status, dateCreated, dateUpdated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?)`,
        [
          venueId,
          req.user.companyId,
          name,
          address || null,
          ...locationValues(req.body),
          phone || null,
          logoUrl || null,
          clipRetentionDays,
          clipPrice,
          now,
          now,
        ]
      );

      await req.db.commit(conn);
      return res.sendSuccess("Venue created successfully", { venueId }, 201);
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }
  })
);

/**
 * PUT /:venueId
 */
router.put(
  "/:venueId",
  checkPermission("venues", "list", "write"),
  validateBody(updateVenueSchema),
  catchAsync(async (req, res) => {
    const { venueId } = req.params;
    const { name, address, phone, logoUrl, clipRetentionDays, clipPrice, status } = req.body;
    assertLogo(req, logoUrl);
    const now = getCurrentTimestampLocal();

    let conn;
    try {
      conn = await req.db.beginTransaction();

      const [target] = await conn.execute(
        `SELECT venueId FROM venues
         WHERE venueId = ? AND companyId = ? AND status != 'Deleted' LIMIT 1 FOR UPDATE`,
        [venueId, callerCompany(req)]
      );
      if (target.length === 0) {
        await req.db.rollback(conn);
        return res.sendError("Venue not found", 404);
      }

      const [clash] = await conn.execute(
        `SELECT venueId FROM venues
         WHERE name = ? AND venueId != ? AND companyId = ? AND status != 'Deleted'
         LIMIT 1 FOR UPDATE`,
        [name, venueId, callerCompany(req)]
      );
      if (clash.length > 0) {
        await req.db.rollback(conn);
        return res.sendError("A venue with this name already exists", 409);
      }

      await conn.execute(
        `UPDATE venues
         SET name = ?, address = ?, ${LOCATION_COLUMNS.map((c) => `${c} = ?`).join(", ")},
             phone = ?, logoUrl = ?, clipRetentionDays = ?, clipPrice = ?, status = ?, dateUpdated = ?
         WHERE venueId = ? AND companyId = ?`,
        [
          name,
          address || null,
          ...locationValues(req.body),
          phone || null,
          logoUrl || null,
          clipRetentionDays,
          clipPrice,
          status || "Active",
          now,
          venueId,
          callerCompany(req),
        ]
      );

      await req.db.commit(conn);
      return res.sendSuccess("Venue updated successfully");
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }
  })
);

/**
 * DELETE /:venueId — soft delete.
 * Its courts go with it (their QR signs stop working) and its recorder boxes
 * are revoked, so nothing keeps recording for a venue that no longer exists.
 * Clips already made stay until they expire.
 */
router.delete(
  "/:venueId",
  checkPermission("venues", "list", "write"),
  catchAsync(async (req, res) => {
    const { venueId } = req.params;
    const now = getCurrentTimestampLocal();

    let conn;
    try {
      conn = await req.db.beginTransaction();

      const [result] = await conn.execute(
        `UPDATE venues SET status = 'Deleted', dateUpdated = ?
         WHERE venueId = ? AND companyId = ? AND status != 'Deleted'`,
        [now, venueId, callerCompany(req)]
      );
      if (result.affectedRows === 0) {
        await req.db.rollback(conn);
        return res.sendError("Venue not found", 404);
      }

      await conn.execute(
        `UPDATE courts SET status = 'Deleted', dateUpdated = ?
         WHERE venueId = ? AND status != 'Deleted'`,
        [now, venueId]
      );
      await conn.execute(
        `UPDATE devices SET status = 'Revoked', dateUpdated = ?
         WHERE venueId = ? AND status = 'Active'`,
        [now, venueId]
      );

      await req.db.commit(conn);
      return res.sendSuccess("Venue deleted successfully");
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }
  })
);

export default router;
