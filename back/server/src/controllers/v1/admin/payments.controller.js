import express from "express";
import { catchAsync, validateBody, validateQuery } from "../../../utils/catchAsync.js";
import { getCurrentTimestampLocal, getTodayDateLocal } from "../../../utils/dateUtils.js";
import { checkPermission } from "../../../middlewares/checkPermission.middleware.js";
import { signUploadUrl } from "../../../utils/file/signedUrl.js";
import { recordCashPayment } from "../../../utils/payments.js";
import {
  createPaymentSchema,
  listPaymentsQuerySchema,
  lookupPaymentQuerySchema,
  refundPaymentSchema,
} from "../../../validators/payments.validator.js";

/**
 * Payments — cash taken at the front desk for players' clips (PLAN-001
 * Phase 4; online payment deferred). Permission: payments.
 *
 * A priced clip is Unpaid until a payment is recorded here, by the pay code
 * the player shows or from the clip itself. Refunding locks the clip again.
 */
const router = express.Router();

const CLIP_FOR_PAYMENT = `
  SELECT cl.clipId, cl.venueId, v.name AS venueName, c.name AS courtName, cl.source,
         cl.requestedAt, cl.price, cl.paymentStatus, cl.payCode, cl.status, cl.thumbnailPath
  FROM clips cl
  JOIN venues v ON v.venueId = cl.venueId
  JOIN courts c ON c.courtId = cl.courtId`;

const toClipSummary = ({ thumbnailPath, ...clip }) => ({
  ...clip,
  price: Number(clip.price),
  thumbnailUrl: clip.status === "Ready" ? signUploadUrl(thumbnailPath) : null,
});

/**
 * GET /
 * Payments, newest first, with totals for the filter and for today.
 */
router.get(
  "/",
  checkPermission("payments", null, "read"),
  validateQuery(listPaymentsQuerySchema),
  catchAsync(async (req, res) => {
    const { page = 1, pageSize = 20, venueId, status, dateFrom, dateTo } = req.query;
    const offset = (page - 1) * pageSize;
    const params = [];
    let whereClause = "WHERE 1 = 1";
    if (venueId) {
      whereClause += " AND p.venueId = ?";
      params.push(venueId);
    }
    if (status) {
      whereClause += " AND p.status = ?";
      params.push(status);
    }
    if (dateFrom) {
      whereClause += " AND p.paidAt >= ?";
      params.push(`${dateFrom} 00:00:00`);
    }
    if (dateTo) {
      whereClause += " AND p.paidAt <= ?";
      params.push(`${dateTo} 23:59:59`);
    }

    const today = getTodayDateLocal();
    const venueScope = venueId ? " AND venueId = ?" : "";
    const venueParams = venueId ? [venueId] : [];

    const [countRows, payments, totals] = await Promise.all([
      req.db.query(`SELECT COUNT(*) AS total FROM payments p ${whereClause}`, params),
      req.db.query(
        `SELECT p.paymentId, p.clipId, p.venueId, v.name AS venueName, c.name AS courtName,
                cl.payCode, cl.requestedAt, p.amount, p.method, p.status, p.note, p.paidAt,
                p.refundedAt,
                COALESCE(CONCAT(u.firstName, ' ', u.lastName), CONCAT(pa.name, ' (phone)'))
                  AS receivedBy
         FROM payments p
         JOIN venues v ON v.venueId = p.venueId
         JOIN clips cl ON cl.clipId = p.clipId
         JOIN courts c ON c.courtId = cl.courtId
         LEFT JOIN users u ON u.accountId = p.receivedByAccountId
         LEFT JOIN paired_apps pa ON pa.pairedAppId = p.pairedAppId
         ${whereClause}
         ORDER BY p.paidAt DESC
         LIMIT ? OFFSET ?`,
        [...params, Number(pageSize), Number(offset)]
      ),
      req.db.query(
        `SELECT
           COALESCE(SUM(CASE WHEN paidAt >= ? THEN amount END), 0) AS today,
           COALESCE(SUM(CASE WHEN paidAt >= ? THEN amount END), 0) AS thisMonth,
           SUM(paidAt >= ?) AS countToday
         FROM payments
         WHERE status = 'Paid'${venueScope}`,
        [
          `${today} 00:00:00`,
          `${today.slice(0, 8)}01 00:00:00`,
          `${today} 00:00:00`,
          ...venueParams,
        ]
      ),
    ]);

    const total = countRows[0]?.total || 0;
    return res.sendSuccess("Payments retrieved successfully", {
      payments: payments.map((p) => ({ ...p, amount: Number(p.amount) })),
      totals: {
        today: Number(totals[0].today),
        thisMonth: Number(totals[0].thisMonth),
        countToday: Number(totals[0].countToday || 0),
      },
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
 * Venues for the Payments filter — under the payments permission.
 */
router.get(
  "/options",
  checkPermission("payments", null, "read"),
  catchAsync(async (req, res) => {
    const venues = await req.db.query(
      `SELECT venueId, name, status FROM venues WHERE status != 'Deleted' ORDER BY name ASC`
    );
    return res.sendSuccess("Payment filter options", { venues });
  })
);

/**
 * GET /lookup?payCode=K7QM2P
 * Find the clip a player wants to pay for, so staff can check it (court, time,
 * thumbnail, price) before taking the cash.
 */
router.get(
  "/lookup",
  checkPermission("payments", null, "read"),
  validateQuery(lookupPaymentQuerySchema),
  catchAsync(async (req, res) => {
    const rows = await req.db.query(
      `${CLIP_FOR_PAYMENT} WHERE cl.payCode = ? AND cl.status != 'Deleted' LIMIT 1`,
      [req.query.payCode]
    );
    if (rows.length === 0) {
      return res.sendError("No clip has that pay code", 404);
    }
    return res.sendSuccess("Clip found", { clip: toClipSummary(rows[0]) });
  })
);

/**
 * POST /
 * Record a cash payment for a clip (by pay code or clipId) — the clip unlocks.
 */
router.post(
  "/",
  checkPermission("payments", null, "write"),
  validateBody(createPaymentSchema),
  catchAsync(async (req, res) => {
    const { payCode, clipId, note } = req.body;

    let conn;
    let result;
    try {
      conn = await req.db.beginTransaction();
      result = await recordCashPayment(conn, {
        payCode,
        clipId,
        note,
        accountId: req.user.accountId,
      });
      if (result.ok) await req.db.commit(conn);
      else await req.db.rollback(conn);
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }

    if (!result.ok) {
      return res.sendError(result.message, result.status);
    }
    return res.sendSuccess(
      "Payment recorded — the clip is unlocked",
      { paymentId: result.paymentId, clipId: result.clipId, amount: result.amount },
      201
    );
  })
);

/**
 * POST /:paymentId/refund — the clip is locked again
 */
router.post(
  "/:paymentId/refund",
  checkPermission("payments", null, "write"),
  validateBody(refundPaymentSchema),
  catchAsync(async (req, res) => {
    const now = getCurrentTimestampLocal();

    let conn;
    try {
      conn = await req.db.beginTransaction();
      const [rows] = await conn.execute(
        `SELECT paymentId, clipId, status FROM payments WHERE paymentId = ? LIMIT 1 FOR UPDATE`,
        [req.params.paymentId]
      );
      if (rows.length === 0) {
        await req.db.rollback(conn);
        return res.sendError("Payment not found", 404);
      }
      if (rows[0].status !== "Paid") {
        await req.db.rollback(conn);
        return res.sendError("This payment is already refunded", 409);
      }

      await conn.execute(
        `UPDATE payments
         SET status = 'Refunded', refundedAt = ?, refundedByAccountId = ?,
             note = COALESCE(?, note), dateUpdated = ?
         WHERE paymentId = ?`,
        [now, req.user.accountId, req.body.note || null, now, rows[0].paymentId]
      );
      await conn.execute(
        `UPDATE clips SET paymentStatus = 'Unpaid', dateUpdated = ?
         WHERE clipId = ? AND paymentStatus = 'Paid'`,
        [now, rows[0].clipId]
      );

      await req.db.commit(conn);
      return res.sendSuccess("Payment refunded — the clip is locked again");
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }
  })
);

export default router;
