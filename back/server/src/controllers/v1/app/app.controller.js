import express from "express";
import { catchAsync, validateBody, validateQuery } from "../../../utils/catchAsync.js";
import { getCurrentTimestampLocal } from "../../../utils/dateUtils.js";
import { ERROR_CODES } from "../../../utils/APIError.js";
import { CLIP_DURATION_SECONDS, clipShareUrl } from "../../../utils/clips.js";
import { COURT_RECORDING_COLUMNS, onlineSince, requestClip } from "../../../utils/clipRequests.js";
import { signUploadUrl } from "../../../utils/file/signedUrl.js";
import { recordCashPayment } from "../../../utils/payments.js";
import {
  appCreatePaymentSchema,
  appPayCodeQuerySchema,
  recentClipsQuerySchema,
} from "../../../validators/pairing.validator.js";

/**
 * Paired staff phone API (PLAN-002) — mounted at /api/v1/app behind
 * `requirePairedApp`, so `req.pairedApp` is always set and every query is
 * scoped to its venue (another venue's court or clip is a 404).
 *
 *   GET  /me                       the phone's name and venue
 *   GET  /courts                   the venue's active courts
 *   POST /courts/:courtId/clips    Record — save the last 60 s (STAFF clip)
 *   GET  /courts/:courtId/clips    that court's recent clips (show a QR again)
 *   GET  /clips/:clipId            a clip's status + share link (QR screen)
 *   GET  /payments/lookup?payCode= the clip a player wants to pay for
 *   POST /payments                 record cash for it
 */
const router = express.Router();

const toAppClip = (row) => ({
  clipId: row.clipId,
  courtId: row.courtId,
  courtName: row.courtName,
  source: row.source,
  requestedAt: row.requestedAt,
  durationSeconds: row.durationSeconds,
  // To staff a clip being cut is still "saving"
  status: row.status === "Processing" ? "Pending" : row.status,
  shareUrl: clipShareUrl(row.shareToken),
  thumbnailUrl: row.status === "Ready" ? signUploadUrl(row.thumbnailPath) : null,
  price: Number(row.price),
  paymentStatus: row.paymentStatus,
  payCode: row.paymentStatus === "Unpaid" ? row.payCode : null,
});

const CLIP_COLUMNS = `cl.clipId, cl.courtId, c.name AS courtName, cl.source, cl.requestedAt,
  cl.durationSeconds, cl.status, cl.shareToken, cl.thumbnailPath, cl.price, cl.paymentStatus,
  cl.payCode`;

/**
 * GET /me
 */
router.get(
  "/me",
  catchAsync(async (req, res) => {
    const [venue] = await req.db.query(
      `SELECT venueId, name, logoUrl, clipPrice FROM venues WHERE venueId = ? LIMIT 1`,
      [req.pairedApp.venueId]
    );
    return res.sendSuccess("Paired phone", {
      pairedApp: { pairedAppId: req.pairedApp.pairedAppId, name: req.pairedApp.name },
      venue: {
        venueId: venue.venueId,
        name: venue.name,
        logoUrl: signUploadUrl(venue.logoUrl),
        clipPrice: Number(venue.clipPrice),
      },
      clipSeconds: CLIP_DURATION_SECONDS,
    });
  })
);

/**
 * GET /courts
 */
router.get(
  "/courts",
  catchAsync(async (req, res) => {
    const courts = await req.db.query(
      `SELECT ${COURT_RECORDING_COLUMNS}
       FROM courts c
       JOIN venues v ON v.venueId = c.venueId
       WHERE c.venueId = ? AND c.status = 'Active'
       ORDER BY c.name ASC`,
      [onlineSince(), req.pairedApp.venueId]
    );
    return res.sendSuccess("Courts", {
      courts: courts.map((court) => ({
        courtId: court.courtId,
        name: court.name,
        hasCamera: Boolean(court.hasCamera),
        recorderOnline: Boolean(court.recorderOnline),
        canRecord: Boolean(court.hasCamera) && Boolean(court.recorderOnline),
      })),
    });
  })
);

/**
 * POST /courts/:courtId/clips — Record
 */
router.post(
  "/courts/:courtId/clips",
  catchAsync(async (req, res) => {
    let conn;
    let result;
    try {
      conn = await req.db.beginTransaction();
      const [courts] = await conn.execute(
        `SELECT ${COURT_RECORDING_COLUMNS}
         FROM courts c
         JOIN venues v ON v.venueId = c.venueId
         WHERE c.courtId = ? AND c.venueId = ? AND c.status = 'Active' AND v.status = 'Active'
         LIMIT 1`,
        [onlineSince(), req.params.courtId, req.pairedApp.venueId]
      );
      if (courts.length === 0) {
        await req.db.rollback(conn);
        return res.sendError("Court not found", 404);
      }
      result = await requestClip(conn, courts[0], {
        source: "STAFF",
        requestedAt: getCurrentTimestampLocal(),
        pairedAppId: req.pairedApp.pairedAppId,
      });
      await req.db.commit(conn);
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }

    if (!result.ok) {
      return res.sendError(
        "This court's camera or recorder box is offline — tell the manager",
        null,
        503,
        ERROR_CODES.CAMERA_OFFLINE
      );
    }
    const body = {
      clipId: result.clipId,
      shareUrl: clipShareUrl(result.shareToken),
      merged: result.merged,
    };
    return result.merged
      ? res.sendSuccess("This moment is already being saved", body)
      : res.sendSuccess("Saving the clip", body, 201);
  })
);

/**
 * GET /courts/:courtId/clips?limit=10 — recent clips on a court
 */
router.get(
  "/courts/:courtId/clips",
  validateQuery(recentClipsQuerySchema),
  catchAsync(async (req, res) => {
    const courts = await req.db.query(
      `SELECT courtId FROM courts WHERE courtId = ? AND venueId = ? AND status != 'Deleted' LIMIT 1`,
      [req.params.courtId, req.pairedApp.venueId]
    );
    if (courts.length === 0) {
      return res.sendError("Court not found", 404);
    }
    const clips = await req.db.query(
      `SELECT ${CLIP_COLUMNS}
       FROM clips cl JOIN courts c ON c.courtId = cl.courtId
       WHERE cl.courtId = ? AND cl.status != 'Deleted'
       ORDER BY cl.requestedAt DESC
       LIMIT ?`,
      [req.params.courtId, Number(req.query.limit || 10)]
    );
    return res.sendSuccess("Recent clips", { clips: clips.map(toAppClip) });
  })
);

/**
 * GET /clips/:clipId
 */
router.get(
  "/clips/:clipId",
  catchAsync(async (req, res) => {
    const rows = await req.db.query(
      `SELECT ${CLIP_COLUMNS}
       FROM clips cl JOIN courts c ON c.courtId = cl.courtId
       WHERE cl.clipId = ? AND cl.venueId = ? AND cl.status != 'Deleted'
       LIMIT 1`,
      [req.params.clipId, req.pairedApp.venueId]
    );
    if (rows.length === 0) {
      return res.sendError("Clip not found", 404);
    }
    return res.sendSuccess("Clip", { clip: toAppClip(rows[0]) });
  })
);

/**
 * GET /payments/lookup?payCode= — this venue's clips only
 */
router.get(
  "/payments/lookup",
  validateQuery(appPayCodeQuerySchema),
  catchAsync(async (req, res) => {
    const rows = await req.db.query(
      `SELECT ${CLIP_COLUMNS}
       FROM clips cl JOIN courts c ON c.courtId = cl.courtId
       WHERE cl.payCode = ? AND cl.venueId = ? AND cl.status != 'Deleted'
       LIMIT 1`,
      [req.query.payCode, req.pairedApp.venueId]
    );
    if (rows.length === 0) {
      return res.sendError("No clip at this venue has that pay code", 404);
    }
    const clip = toAppClip(rows[0]);
    // The lookup shows the code even once paid, so staff can confirm it
    return res.sendSuccess("Clip found", { clip: { ...clip, payCode: rows[0].payCode } });
  })
);

/**
 * POST /payments — record cash for a clip of this venue
 */
router.post(
  "/payments",
  validateBody(appCreatePaymentSchema),
  catchAsync(async (req, res) => {
    let conn;
    let result;
    try {
      conn = await req.db.beginTransaction();
      result = await recordCashPayment(conn, {
        payCode: req.body.payCode,
        venueId: req.pairedApp.venueId,
        pairedAppId: req.pairedApp.pairedAppId,
        note: req.body.note,
      });
      if (result.ok) await req.db.commit(conn);
      else await req.db.rollback(conn);
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }
    if (!result.ok) {
      return res.sendError(
        result.status === 404 ? "No clip at this venue has that pay code" : result.message,
        result.status
      );
    }
    return res.sendSuccess(
      "Payment recorded — the clip is unlocked",
      { paymentId: result.paymentId, clipId: result.clipId, amount: result.amount },
      201
    );
  })
);

export default router;
