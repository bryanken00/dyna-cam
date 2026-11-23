import { logger } from "../../config/logger.js";
import * as xendit from "../lib/payments/xendit.js";
import { getCurrentTimestampLocal, moment } from "./dateUtils.js";
import { bookingManageUrl } from "./clips.js";
import { findConflict } from "./courtTimeline.js";
import { sendBookingEmail } from "./bookingEmails.js";

/**
 * PLAN-003 Phase F — paying a booking online through Xendit, and giving the
 * money back. lib/payments/xendit.js talks to Xendit; this file decides what a
 * payment means for a booking.
 *
 *   openCheckout()     a hosted checkout for an unpaid, held booking
 *   resumeCheckout()   the booking's open checkout, or a new one while the hold lasts
 *   settleInvoice()    a paid invoice (the webhook, or a player back from the
 *                      checkout) → a payment row, then Confirmed or refunded
 *   sendRefunds()      online payments queued for a refund → Xendit
 *   handleRefundEvent()  Xendit's refund.failed → the payment shows Refund failed
 *   runPaymentFollowUps()  after a cancel / move / desk payment commits: the
 *                      refunds to send and the checkouts to close
 *
 * Money is believed only from Xendit's API (getInvoice), never from a webhook
 * body or a redirect, and the amount always comes from bookings.price.
 *
 * A refund is two steps so a crash in between can't lose it: inside the
 * cancel's transaction the payment is flagged REFUND_QUEUED; after commit
 * sendRefunds() claims it, calls Xendit, and marks it Refunded — or keeps
 * refundError set, which Admin shows as "Refund failed".
 */

const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";
const FORMAT = "YYYY-MM-DD HH:mm:ss";

/** payments.refundError while a refund is on its way (both read as "Refund failed" if stuck). */
export const REFUND_QUEUED = "Refund not sent yet";
export const REFUND_SENDING = "Refund being sent";
/** A refund "being sent" this long ago crashed mid-way; it may be claimed again. */
const STALE_SENDING_MINUTES = 5;

/** A checkout must stay payable at least this long, or it isn't worth opening. */
export const MIN_CHECKOUT_SECONDS = 120;

const fail = (status, message, code) => ({ ok: false, status, message, code });

/** Our reference on the Xendit invoice — the code the player already has, never an ID. */
export const invoiceExternalId = (bookingCode) => `booking-${bookingCode}`;
const bookingCodeOf = (externalId) =>
  /^booking-([A-Z0-9]{4,12})$/.exec(externalId || "")?.[1] || null;

const cents = (amount) => Math.round(Number(amount) * 100);

const secondsUntil = (local, now) =>
  moment.tz(local, FORMAT, TIMEZONE).diff(moment.tz(now, FORMAT, TIMEZONE), "seconds");

const clock = (local) => moment.tz(local, FORMAT, TIMEZONE).format("h:mm A");

/**
 * How long an online booking's slot is held for its checkout: the venue's
 * onlineHoldMinutes, but never past the start.
 */
export const onlineHoldUntil = ({ startLocal, onlineHoldMinutes, now }) => {
  const until = moment.tz(now, FORMAT, TIMEZONE).add(onlineHoldMinutes, "minutes").format(FORMAT);
  return until < startLocal ? until : startLocal;
};

/** Close a checkout so it can't be paid. Never throws: a failure is logged. */
export const expireCheckout = async (checkoutId) => {
  if (!checkoutId || !xendit.isOnlinePaymentOn()) return false;
  try {
    const result = await xendit.expireInvoice(checkoutId);
    return result.expired;
  } catch (err) {
    logger.warn("Xendit: could not expire a checkout", { checkoutId, error: err.message });
    return false;
  }
};

/**
 * Open a Xendit checkout for a held booking (Pending, Unpaid) and remember it
 * on the booking. Outside a transaction: it calls Xendit.
 *
 * @returns {Promise<{ ok: true, checkoutUrl: string } | { ok: false, status, message, code? }>}
 */
export const openCheckout = async (db, { bookingId }) => {
  if (!xendit.isOnlinePaymentOn()) {
    return fail(409, "Online payment isn't available here — pay at the desk");
  }
  const now = getCurrentTimestampLocal();
  const rows = await db.query(
    `SELECT b.bookingId, b.bookingCode, b.manageToken, b.startAt, b.endAt, b.price, b.email,
            b.holdExpiresAt, b.status, b.paymentStatus, c.name AS courtName, v.name AS venueName
     FROM bookings b
     JOIN courts c ON c.courtId = b.courtId
     JOIN venues v ON v.venueId = b.venueId
     WHERE b.bookingId = ? LIMIT 1`,
    [bookingId]
  );
  const b = rows[0];
  if (!b || b.status !== "Pending" || b.paymentStatus !== "Unpaid") {
    return fail(409, "This booking isn't waiting for payment");
  }
  const seconds = b.holdExpiresAt ? secondsUntil(b.holdExpiresAt, now) : 0;
  if (seconds < MIN_CHECKOUT_SECONDS) {
    return fail(409, "The hold on this slot is running out — book it again");
  }

  let invoice;
  try {
    invoice = await xendit.createInvoice({
      externalId: invoiceExternalId(b.bookingCode),
      amount: Number(b.price),
      durationSeconds: seconds,
      returnUrl: `${bookingManageUrl(b.manageToken)}?checkout=done`,
      email: b.email,
      description: `${b.venueName} · ${b.courtName} · ${b.startAt.slice(0, 10)} ${clock(b.startAt)}–${clock(b.endAt)} · Booking ${b.bookingCode}`,
    });
  } catch (err) {
    logger.error("Xendit: could not open a checkout", {
      bookingId,
      error: err.message,
      code: err.code,
    });
    return fail(
      502,
      "Online payment isn't working right now — try again in a minute, or pay at the desk"
    );
  }

  // Only while it's still waiting for payment (staff may have acted meanwhile)
  const updated = await db.query(
    `UPDATE bookings SET checkoutId = ?, checkoutUrl = ?, dateUpdated = ?
     WHERE bookingId = ? AND status = 'Pending' AND paymentStatus = 'Unpaid'`,
    [invoice.id, invoice.url, getCurrentTimestampLocal(), bookingId]
  );
  if (Number(updated?.affectedRows || 0) === 0) {
    await expireCheckout(invoice.id);
    return fail(409, "This booking isn't waiting for payment");
  }
  return { ok: true, checkoutUrl: invoice.url };
};

/**
 * The player's "Pay": reopen the open checkout (same invoice, same page), or
 * open a new one if it expired or no longer matches the price — while the hold lasts.
 * A checkout that turns out to be paid is settled right here.
 *
 * @returns {Promise<{ ok: true, checkoutUrl?: string, paid?: boolean } | { ok: false, ... }>}
 */
export const resumeCheckout = async (db, booking) => {
  if (booking.checkoutId) {
    let invoice = null;
    try {
      invoice = await xendit.getInvoice(booking.checkoutId);
    } catch (err) {
      logger.warn("Xendit: could not read a checkout", {
        checkoutId: booking.checkoutId,
        error: err.message,
      });
      if (err.transient) {
        return fail(502, "Online payment isn't working right now — try again in a minute");
      }
    }
    if (invoice?.paid) {
      const settled = await settleInvoice(db, invoice.id, { invoice });
      if (settled.outcome === "CONFIRMED" || settled.outcome === "ALREADY_RECORDED") {
        return { ok: true, paid: true };
      }
      return fail(409, "That payment couldn't be kept for this booking — it's being refunded");
    }
    if (
      invoice?.status === "PENDING" &&
      invoice.url &&
      cents(invoice.amount) === cents(booking.price)
    ) {
      return { ok: true, checkoutUrl: invoice.url };
    }
    if (invoice?.status === "PENDING") await expireCheckout(invoice.id);
  }
  return openCheckout(db, { bookingId: booking.bookingId });
};

/** Lock a booking by its code — any status, Deleted too (a payment for it still needs a home). */
const lockBookingByCode = async (conn, bookingCode) => {
  const [peek] = await conn.execute(`SELECT courtId FROM bookings WHERE bookingCode = ? LIMIT 1`, [
    bookingCode,
  ]);
  if (peek.length === 0) return null;
  // Court first, then the booking — the lock order every booking writer uses
  await conn.execute(`SELECT courtId FROM courts WHERE courtId = ? LIMIT 1 FOR UPDATE`, [
    peek[0].courtId,
  ]);
  const [rows] = await conn.execute(
    `SELECT * FROM bookings WHERE bookingCode = ? LIMIT 1 FOR UPDATE`,
    [bookingCode]
  );
  return rows[0] || null;
};

/**
 * Should this paid invoice confirm its booking? Otherwise the money goes back.
 * @returns {Promise<{ keep: true } | { keep: false, reason: string, why: string }>}
 */
const decide = async (conn, booking, invoice, now) => {
  if (cents(invoice.amount) !== cents(booking.price)) {
    // An old checkout from before the booking was repriced
    return { keep: false, reason: "OTHERS", why: "AMOUNT_MISMATCH" };
  }
  if (booking.paymentStatus !== "Unpaid") {
    return { keep: false, reason: "DUPLICATE", why: "ALREADY_PAID" };
  }
  if (booking.status === "Pending" && (!booking.holdExpiresAt || booking.holdExpiresAt > now)) {
    return { keep: true };
  }
  // Paid after the hold ran out: still theirs if nobody took the slot meanwhile
  if (["Pending", "Expired"].includes(booking.status) && booking.endAt > now) {
    const conflict = await findConflict(conn, {
      courtId: booking.courtId,
      startLocal: booking.startAt,
      endLocal: booking.endAt,
      ignoreBookingId: booking.bookingId,
      checkHours: true,
      now,
    });
    if (!conflict) return { keep: true };
    return { keep: false, reason: "CANCELLATION", why: "SLOT_TAKEN" };
  }
  return {
    keep: false,
    reason: "CANCELLATION",
    why: `BOOKING_${String(booking.status).toUpperCase()}`,
  };
};

/**
 * A paid Xendit invoice → one payment row (unique providerRef, so a retried
 * webhook records nothing twice), then the booking Paid + Confirmed in the
 * same transaction — or, when the booking can't have it (the slot was lost,
 * it was cancelled or already paid, the price changed), a full refund.
 *
 * @param db - req.db
 * @param {string} invoiceId
 * @param {{ invoice?: object }} [options] - an invoice already read from Xendit
 * @returns {Promise<{ outcome: "NOT_PAID"|"UNKNOWN_BOOKING"|"ALREADY_RECORDED"|"CONFIRMED"
 *   |"REFUNDED"|"REFUND_FAILED", why?: string }>}
 * @throws {xendit.XenditError} when Xendit can't be asked (the webhook answers 503, Xendit retries)
 */
export const settleInvoice = async (db, invoiceId, { invoice: known } = {}) => {
  const invoice = known || (await xendit.getInvoice(invoiceId));
  if (!invoice.paid) return { outcome: "NOT_PAID" };
  const bookingCode = bookingCodeOf(invoice.externalId);
  if (!bookingCode) {
    logger.warn("Xendit: a paid invoice that isn't a booking", { invoiceId: invoice.id });
    return { outcome: "UNKNOWN_BOOKING" };
  }

  const now = getCurrentTimestampLocal();
  let conn;
  let paymentId;
  let decision;
  let bookingId;
  try {
    conn = await db.beginTransaction();
    const booking = await lockBookingByCode(conn, bookingCode);
    if (!booking) {
      await db.rollback(conn);
      logger.warn("Xendit: a paid invoice for no booking", { invoiceId: invoice.id, bookingCode });
      return { outcome: "UNKNOWN_BOOKING" };
    }
    const [existing] = await conn.execute(
      `SELECT paymentId FROM payments WHERE providerRef = ? LIMIT 1`,
      [invoice.id]
    );
    if (existing.length > 0) {
      await db.rollback(conn);
      return { outcome: "ALREADY_RECORDED" };
    }

    bookingId = booking.bookingId;
    decision = await decide(conn, booking, invoice, now);
    const [uuidRow] = await conn.execute(`SELECT UUID() as id`);
    paymentId = uuidRow[0].id;
    await conn.execute(
      `INSERT INTO payments
         (paymentId, bookingId, venueId, amount, method, provider, providerRef, refundError, note,
          status, paidAt, dateCreated, dateUpdated)
       VALUES (?, ?, ?, ?, 'ONLINE', 'xendit', ?, ?, ?, 'Paid', ?, ?, ?)`,
      [
        paymentId,
        booking.bookingId,
        booking.venueId,
        invoice.amount,
        invoice.id,
        decision.keep ? null : REFUND_QUEUED,
        decision.keep ? null : `Paid online but not kept (${decision.why}) — refunded`,
        now,
        now,
        now,
      ]
    );

    if (decision.keep) {
      await conn.execute(
        `UPDATE bookings
         SET status = 'Confirmed', paymentStatus = 'Paid', payMethod = 'Online', holdExpiresAt = NULL,
             checkoutId = NULL, checkoutUrl = NULL, dateUpdated = ?
         WHERE bookingId = ?`,
        [now, booking.bookingId]
      );
    } else {
      // Not kept: a hold that ran out reads Expired now; its checkout is spent
      await conn.execute(
        `UPDATE bookings
         SET status = IF(status = 'Pending' AND holdExpiresAt IS NOT NULL AND holdExpiresAt <= ?,
                         'Expired', status),
             checkoutId = IF(checkoutId = ?, NULL, checkoutId),
             checkoutUrl = IF(checkoutId IS NULL, NULL, checkoutUrl),
             dateUpdated = ?
         WHERE bookingId = ?`,
        [now, invoice.id, now, booking.bookingId]
      );
    }
    await db.commit(conn);
  } catch (err) {
    await db.rollback(conn);
    // Two deliveries of the same webhook at once: the other one recorded it
    if (err.code === "ER_DUP_ENTRY") return { outcome: "ALREADY_RECORDED" };
    throw err;
  }

  if (decision.keep) {
    await sendBookingEmail(db, bookingId, "Confirmed");
    return { outcome: "CONFIRMED" };
  }
  logger.warn("Xendit: refunding a payment the booking can't keep", {
    paymentId,
    bookingCode,
    why: decision.why,
  });
  const [sent] = await sendRefunds(db, { paymentIds: [paymentId], reason: decision.reason });
  // Phase G: tell the player why, and that the money is on its way back
  await sendBookingEmail(db, bookingId, "PaymentRefunded", {
    why: decision.why,
    amount: Number(invoice.amount),
    refunded: Boolean(sent?.ok),
  });
  return { outcome: sent?.ok ? "REFUNDED" : "REFUND_FAILED", why: decision.why };
};

/** The booking reads Refunded once every one of its payments is back (cancelled bookings only). */
const markBookingRefunded = (db, bookingId, now) =>
  db.query(
    `UPDATE bookings SET paymentStatus = 'Refunded', dateUpdated = ?
     WHERE bookingId = ? AND paymentStatus = 'Paid' AND status = 'Cancelled'
       AND NOT EXISTS (SELECT 1 FROM payments WHERE bookingId = ? AND status = 'Paid')`,
    [now, bookingId, bookingId]
  );

/**
 * Send the refunds of online payments queued for one (refundError set,
 * still Paid). Each is claimed first, so two senders never refund twice.
 * Outside a transaction: it calls Xendit. Never throws.
 *
 * @param db - req.db
 * @param {Object} options
 * @param {string[]} options.paymentIds
 * @param {string} [options.reason] - a Xendit refund reason
 * @param {string|null} [options.accountId] - the staff member who asked
 * @returns {Promise<Array<{ paymentId, ok: boolean, amount?: number, error?: string }>>}
 */
export const sendRefunds = async (
  db,
  { paymentIds, reason = "CANCELLATION", accountId = null }
) => {
  const results = [];
  for (const paymentId of paymentIds) {
    const now = getCurrentTimestampLocal();
    const staleBefore = moment
      .tz(now, FORMAT, TIMEZONE)
      .subtract(STALE_SENDING_MINUTES, "minutes")
      .format(FORMAT);
    const claimed = await db.query(
      `UPDATE payments SET refundError = ?, dateUpdated = ?
       WHERE paymentId = ? AND status = 'Paid' AND method = 'ONLINE' AND provider = 'xendit'
         AND refundError IS NOT NULL AND (refundError != ? OR dateUpdated < ?)`,
      [REFUND_SENDING, now, paymentId, REFUND_SENDING, staleBefore]
    );
    if (Number(claimed?.affectedRows || 0) === 0) {
      results.push({ paymentId, ok: false, error: "Not waiting for a refund" });
      continue;
    }
    const [payment] = await db.query(
      `SELECT paymentId, bookingId, amount, providerRef FROM payments WHERE paymentId = ?`,
      [paymentId]
    );

    let error = null;
    let refundId = null;
    if (!xendit.isOnlinePaymentOn()) {
      error = "Online payment is switched off on the server";
    } else {
      try {
        const sent = await xendit.refund({
          invoiceId: payment.providerRef,
          amount: Number(payment.amount),
          referenceId: payment.paymentId,
          reason,
        });
        if (sent.status === "FAILED") error = `Xendit refused it (${sent.failureCode || "FAILED"})`;
        else refundId = sent.id;
      } catch (err) {
        error = `Xendit refused it: ${err.code ? `${err.code} — ` : ""}${err.message}`;
      }
    }

    const done = getCurrentTimestampLocal();
    if (error) {
      logger.error("Xendit: refund failed", { paymentId, error });
      await db.query(`UPDATE payments SET refundError = ?, dateUpdated = ? WHERE paymentId = ?`, [
        error.slice(0, 255),
        done,
        paymentId,
      ]);
      results.push({ paymentId, ok: false, amount: Number(payment.amount), error });
      continue;
    }
    await db.query(
      `UPDATE payments
       SET status = 'Refunded', refundedAt = ?, refundedByAccountId = ?, providerRefundRef = ?,
           refundError = NULL, dateUpdated = ?
       WHERE paymentId = ?`,
      [done, accountId, refundId, done, paymentId]
    );
    await markBookingRefunded(db, payment.bookingId, done);
    results.push({ paymentId, ok: true, amount: Number(payment.amount) });
  }
  return results;
};

/**
 * Xendit's refund.succeeded / refund.failed: a refund it first accepted may
 * still fail at the e-wallet or bank. Believed only from Xendit's API.
 *
 * @returns {Promise<{ outcome: "UNKNOWN_REFUND"|"NO_CHANGE"|"REFUND_FAILED" }>}
 * @throws {xendit.XenditError} when Xendit can't be asked
 */
export const handleRefundEvent = async (db, refundId) => {
  const rows = await db.query(
    `SELECT paymentId, bookingId, status FROM payments WHERE providerRefundRef = ? LIMIT 1`,
    [refundId]
  );
  if (rows.length === 0) return { outcome: "UNKNOWN_REFUND" };
  const found = await xendit.getRefund(refundId);
  if (found.status !== "FAILED" || rows[0].status !== "Refunded") return { outcome: "NO_CHANGE" };

  const now = getCurrentTimestampLocal();
  await db.query(
    `UPDATE payments
     SET status = 'Paid', refundedAt = NULL, refundedByAccountId = NULL, refundError = ?, dateUpdated = ?
     WHERE paymentId = ? AND status = 'Refunded'`,
    [
      `Xendit couldn't complete the refund (${found.failureCode || "FAILED"})`.slice(0, 255),
      now,
      rows[0].paymentId,
    ]
  );
  await db.query(
    `UPDATE bookings SET paymentStatus = 'Paid', dateUpdated = ?
     WHERE bookingId = ? AND paymentStatus = 'Refunded'`,
    [now, rows[0].bookingId]
  );
  logger.error("Xendit: a refund failed after it was accepted", {
    paymentId: rows[0].paymentId,
    refundId,
  });
  return { outcome: "REFUND_FAILED" };
};

/**
 * What a booking write left for after its commit: close its open checkout
 * (cancelled, moved, paid at the desk) and send its queued online refunds.
 * Never throws.
 *
 * @param db - req.db
 * @param {{ closeCheckoutId?: string|null, refundPaymentIds?: string[] }} followUp
 * @param {{ accountId?: string|null, reason?: string }} [options]
 * @returns {Promise<{ refunded: number, failed: number, refunds: Array }>} refunded / failed in pesos
 */
export const runPaymentFollowUps = async (
  db,
  { closeCheckoutId = null, refundPaymentIds = [] } = {},
  { accountId = null, reason = "CANCELLATION" } = {}
) => {
  if (closeCheckoutId) await expireCheckout(closeCheckoutId);
  const refunds = refundPaymentIds.length
    ? await sendRefunds(db, { paymentIds: refundPaymentIds, reason, accountId })
    : [];
  const sum = (list) => list.reduce((total, r) => total + (r.amount || 0), 0);
  return {
    refunded: sum(refunds.filter((r) => r.ok)),
    failed: sum(refunds.filter((r) => !r.ok)),
    refunds,
  };
};
