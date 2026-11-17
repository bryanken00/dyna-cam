import express from "express";
import { catchAsync, validateQuery } from "../../../utils/catchAsync.js";
import { getCurrentTimestampLocal } from "../../../utils/dateUtils.js";
import { checkPermission } from "../../../middlewares/checkPermission.middleware.js";
import { clipShareUrl } from "../../../utils/clips.js";
import { removeClipFiles } from "../../../utils/file/clipFiles.js";
import { signedDownloadUrl, signUploadUrl } from "../../../utils/file/signedUrl.js";
import { listClipsQuerySchema } from "../../../validators/clips.validator.js";

/**
 * Clips — the replays saved from court cameras (PLAN-001).
 * Permission: clips.
 */
const router = express.Router();

const CLIP_SELECT = `
  SELECT cl.clipId, cl.venueId, v.name AS venueName, cl.courtId, c.name AS courtName,
         cl.source, cl.requestedAt, cl.durationSeconds, cl.shareToken, cl.videoPath,
         cl.thumbnailPath, cl.sizeBytes, cl.failureReason, cl.expiresAt, cl.status,
         cl.dateCreated, cl.dateUpdated
  FROM clips cl
  JOIN venues v ON v.venueId = cl.venueId
  JOIN courts c ON c.courtId = cl.courtId`;

const toClip = (row) => {
  const { shareToken, videoPath, thumbnailPath, ...clip } = row;
  const playable = row.status === "Ready";
  return {
    ...clip,
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
        `SELECT c.courtId, c.name, c.venueId, v.name AS venueName
         FROM courts c JOIN venues v ON v.venueId = c.venueId AND v.status != 'Deleted'
         WHERE c.status != 'Deleted'
         ORDER BY v.name ASC, c.name ASC`
      ),
    ]);
    return res.sendSuccess("Clip filter options", { venues, courts });
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

/**
 * DELETE /:clipId — soft delete. The row stays; its files are removed and its
 * share link stops working.
 */
router.delete(
  "/:clipId",
  checkPermission("clips", null, "write"),
  catchAsync(async (req, res) => {
    const { clipId } = req.params;
    const now = getCurrentTimestampLocal();

    let conn;
    let files;
    try {
      conn = await req.db.beginTransaction();

      const [rows] = await conn.execute(
        `SELECT videoPath, thumbnailPath FROM clips
         WHERE clipId = ? AND status != 'Deleted'
         LIMIT 1 FOR UPDATE`,
        [clipId]
      );
      if (rows.length === 0) {
        await req.db.rollback(conn);
        return res.sendError("Clip not found", 404);
      }
      files = rows[0];

      await conn.execute(
        `UPDATE clips SET status = 'Deleted', videoPath = NULL, thumbnailPath = NULL,
                          dateUpdated = ?
         WHERE clipId = ?`,
        [now, clipId]
      );

      await req.db.commit(conn);
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }

    await removeClipFiles(files.videoPath, files.thumbnailPath);
    return res.sendSuccess("Clip deleted successfully");
  })
);

export default router;
