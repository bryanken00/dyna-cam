import express from "express";
import { catchAsync, validateBody, validateQuery } from "../../../utils/catchAsync.js";
import { getCurrentTimestampLocal, getTodayDateLocal } from "../../../utils/dateUtils.js";
import { checkPermission } from "../../../middlewares/checkPermission.middleware.js";
import { listPaymentsQuerySchema, refundPaymentSchema } from "../../../validators/payments.validator.js";
import { REFUND_SENDING } from "../../../utils/bookingPayments.js";

/**
 * Payments — every payment recorded (permission: payments): online booking
 * payments, and the cash taken for clips, games and bookings before CR-046.
 *
 *   GET  /                      the list, with totals
 *   GET  /options               venues for the filter
 *   POST /:paymentId/refund     an old cash payment refunded, or a failed online
 *                               refund repaid by hand
 *
 * CR-046 (no payment at the counter) removed Take payment (GET /lookup,
 * POST /) and the online settlement report (GET /settlement).
 */
const router = express.Router();

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
        `SELECT p.paymentId, p.clipId, p.sessionId, p.bookingId,
                CASE WHEN p.sessionId IS NOT NULL THEN 'Game'
                     WHEN p.bookingId IS NOT NULL THEN 'Booking'
                     ELSE 'Clip' END AS kind,
                p.venueId, v.name AS venueName, c.name AS courtName,
                COALESCE(cl.payCode, s.payCode, bk.bookingCode) AS payCode,
                COALESCE(cl.requestedAt, s.startAt, bk.startAt) AS requestedAt,
                p.amount, p.method, p.status, p.note, p.paidAt, p.refundedAt, p.refundError,
                COALESCE(CONCAT(u.firstName, ' ', u.lastName), CONCAT(pa.name, ' (phone)'))
                  AS receivedBy
         FROM payments p
         JOIN venues v ON v.venueId = p.venueId
         LEFT JOIN clips cl ON cl.clipId = p.clipId
         LEFT JOIN recording_sessions s ON s.sessionId = p.sessionId
         LEFT JOIN bookings bk ON bk.bookingId = p.bookingId
         JOIN courts c ON c.courtId = COALESCE(cl.courtId, s.courtId, bk.courtId)
         LEFT JOIN users u ON u.accountId = p.receivedByAccountId
         LEFT JOIN paired_apps pa ON pa.pairedAppId = p.pairedAppId
         ${whereClause}
         ORDER BY p.paidAt DESC, p.id DESC
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
 * POST /:paymentId/refund — the clip (or the game, CR-015) is locked again
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
        `SELECT paymentId, clipId, sessionId, bookingId, status, refundError FROM payments
         WHERE paymentId = ? LIMIT 1 FOR UPDATE`,
        [req.params.paymentId]
      );
      if (rows.length === 0) {
        await req.db.rollback(conn);
        return res.sendError("Payment not found", 404);
      }
      // Phase F: an online refund Xendit refused — staff repaid the player by hand
      if (rows[0].bookingId && rows[0].status === "Paid" && rows[0].refundError) {
        if (rows[0].refundError === REFUND_SENDING) {
          await req.db.rollback(conn);
          return res.sendError(
            "The online refund is being sent right now — check again in a minute",
            409
          );
        }
        await conn.execute(
          `UPDATE payments
           SET status = 'Refunded', refundedAt = ?, refundedByAccountId = ?, refundError = NULL,
               note = ?, dateUpdated = ?
           WHERE paymentId = ?`,
          [
            now,
            req.user.accountId,
            (
              req.body.note || `Repaid by hand — online refund failed: ${rows[0].refundError}`
            ).slice(0, 255),
            now,
            rows[0].paymentId,
          ]
        );
        await conn.execute(
          `UPDATE bookings SET paymentStatus = 'Refunded', dateUpdated = ?
           WHERE bookingId = ? AND paymentStatus = 'Paid' AND status = 'Cancelled'
             AND NOT EXISTS (SELECT 1 FROM payments WHERE bookingId = ? AND status = 'Paid')`,
          [now, rows[0].bookingId, rows[0].bookingId]
        );
        await req.db.commit(conn);
        return res.sendSuccess("Marked as repaid by hand");
      }
      // PLAN-003: a booking is refunded by cancelling it, which frees its slot too
      if (rows[0].bookingId) {
        await req.db.rollback(conn);
        return res.sendError(
          "This is a court booking — refund it by cancelling the booking in Bookings",
          409
        );
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
      if (rows[0].sessionId) {
        await conn.execute(
          `UPDATE recording_sessions SET paymentStatus = 'Unpaid', dateUpdated = ?
           WHERE sessionId = ? AND paymentStatus = 'Paid'`,
          [now, rows[0].sessionId]
        );
      } else {
        await conn.execute(
          `UPDATE clips SET paymentStatus = 'Unpaid', dateUpdated = ?
           WHERE clipId = ? AND paymentStatus = 'Paid'`,
          [now, rows[0].clipId]
        );
      }

      await req.db.commit(conn);
      return res.sendSuccess(
        rows[0].sessionId
          ? "Payment refunded — the game's videos are locked again"
          : "Payment refunded — the clip is locked again"
      );
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }
  })
);

export default router;
