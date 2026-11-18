import express from "express";
import { catchAsync, validateQuery } from "../../../utils/catchAsync.js";
import { checkPermission } from "../../../middlewares/checkPermission.middleware.js";
import { clipShareUrl } from "../../../utils/clips.js";
import { signedDownloadUrl, signUploadUrl } from "../../../utils/file/signedUrl.js";
import { listClipsQuerySchema } from "../../../validators/clips.validator.js";

/**
 * Clips — the replays saved from court cameras (PLAN-001).
 * Permission: clips. View only since PLAN-002 Phase E: clips are saved by
 * players (court QR / button) and sessions, never from the Admin portal.
 */
const router = express.Router();

const CLIP_SELECT = `
  SELECT cl.clipId, cl.venueId, v.name AS venueName, cl.courtId, c.name AS courtName,
         cl.source, cl.sessionId, cl.partIndex, cl.requestedAt, cl.durationSeconds,
         cl.price, cl.paymentStatus, cl.payCode, cl.pairedAppId,
         (SELECT pa.name FROM paired_apps pa WHERE pa.pairedAppId = cl.pairedAppId)
           AS pairedAppName,
         cl.shareToken, cl.videoPath,
         cl.thumbnailPath, cl.sizeBytes, cl.failureReason, cl.expiresAt, cl.status,
         cl.driveStatus, cl.driveUrl, cl.driveError,
         cl.dateCreated, cl.dateUpdated
  FROM clips cl
  JOIN venues v ON v.venueId = cl.venueId
  JOIN courts c ON c.courtId = cl.courtId`;

const toClip = (row) => {
  const { shareToken, videoPath, thumbnailPath, ...clip } = row;
  const playable = row.status === "Ready";
  return {
    ...clip,
    price: Number(row.price),
    shareUrl: clipShareUrl(shareToken),
    videoUrl: playable ? signUploadUrl(videoPath) : null,
    downloadUrl: playable ? signedDownloadUrl(videoPath) : null,
    thumbnailUrl: playable ? signUploadUrl(thumbnailPath) : null,
  };
};

/**
 * GET /
 * Filters: venueId, courtId, source, status, dateFrom/dateTo (requested date)
 */
router.get(
  "/",
  checkPermission("clips", null, "read"),
  validateQuery(listClipsQuerySchema),
  catchAsync(async (req, res) => {
    const {
      page = 1,
      pageSize = 20,
      venueId,
      courtId,
      source,
      status,
      paymentStatus,
      dateFrom,
      dateTo,
      sortBy = "requestedAt",
      sortOrder = "DESC",
    } = req.query;
    const offset = (page - 1) * pageSize;
    const params = [];
    let whereClause;

    if (status) {
      whereClause = "WHERE cl.status = ?";
      params.push(status);
    } else {
      whereClause = "WHERE cl.status != 'Deleted'";
    }
    // CR-003: a game's parts that went into its whole video live on in Sessions
    whereClause += " AND cl.joinedAt IS NULL";
    if (venueId) {
      whereClause += " AND cl.venueId = ?";
      params.push(venueId);
    }
    if (courtId) {
      whereClause += " AND cl.courtId = ?";
      params.push(courtId);
    }
    if (source) {
      whereClause += " AND cl.source = ?";
      params.push(source);
    }
    if (paymentStatus) {
      whereClause += " AND cl.paymentStatus = ?";
      params.push(paymentStatus);
    }
    if (dateFrom) {
      whereClause += " AND cl.requestedAt >= ?";
      params.push(`${dateFrom} 00:00:00`);
    }
    if (dateTo) {
      whereClause += " AND cl.requestedAt <= ?";
      params.push(`${dateTo} 23:59:59`);
    }

    const allowedSortColumns = ["requestedAt", "dateCreated"];
    const safeSortBy = allowedSortColumns.includes(sortBy) ? sortBy : "requestedAt";
    const safeSortOrder = sortOrder.toUpperCase() === "ASC" ? "ASC" : "DESC";

    const [countRows, clips] = await Promise.all([
      req.db.query(`SELECT COUNT(*) as total FROM clips cl ${whereClause}`, params),
      req.db.query(
        `${CLIP_SELECT}
         ${whereClause}
         ORDER BY cl.${safeSortBy} ${safeSortOrder}
         LIMIT ? OFFSET ?`,
        [...params, Number(pageSize), Number(offset)]
      ),
    ]);

    const total = countRows[0]?.total || 0;

    return res.sendSuccess("Clips retrieved successfully", {
      clips: clips.map(toClip),
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
 * Venues and courts for the Clips filters — under the clips permission, so
 * the page works without the Venues or Courts permissions.
 */
router.get(
  "/options",
  checkPermission("clips", null, "read"),
  catchAsync(async (req, res) => {
    const [venues, courts] = await Promise.all([
      req.db.query(`SELECT venueId, name FROM venues WHERE status != 'Deleted' ORDER BY name ASC`),
      req.db.query(
        `SELECT c.courtId, c.name, c.venueId, v.name AS venueName,
                (c.status = 'Active' AND v.status = 'Active') AS active
         FROM courts c JOIN venues v ON v.venueId = c.venueId AND v.status != 'Deleted'
         WHERE c.status != 'Deleted'
         ORDER BY v.name ASC, c.name ASC`
      ),
    ]);
    return res.sendSuccess("Clip filter options", {
      venues,
      // `active`: the court can save clips now (court and venue both Active)
      courts: courts.map((court) => ({ ...court, active: Boolean(court.active) })),
    });
  })
);

/**
 * GET /:clipId
 */
router.get(
  "/:clipId",
  checkPermission("clips", null, "read"),
  catchAsync(async (req, res) => {
    const rows = await req.db.query(
      `${CLIP_SELECT}
       WHERE cl.clipId = ? AND cl.status != 'Deleted'
       LIMIT 1`,
      [req.params.clipId]
    );

    if (rows.length === 0) {
      return res.sendError("Clip not found", 404);
    }

    return res.sendSuccess("Clip retrieved successfully", { clip: toClip(rows[0]) });
  })
);

export default router;
