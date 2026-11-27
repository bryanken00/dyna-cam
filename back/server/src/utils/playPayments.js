import { logger } from "../../config/logger.js";
import * as xendit from "../lib/payments/xendit.js";
import { paymentAccountForVenue } from "./companyPayments.js";
import { getCurrentTimestampLocal, moment } from "./dateUtils.js";
import { openPlayUrl } from "./clips.js";
import {
  expireCheckout,
  MIN_CHECKOUT_SECONDS,
  REFUND_QUEUED,
  sendRefunds,
  settleInvoice,
} from "./bookingPayments.js";
import { liveSpots } from "./openPlay.js";
import { sendPlayEmail } from "./openPlayEmails.js";

/**
 * PLAN-009 phase C — paying for an Open Play spot online, through the same
 * Xendit flow as bookings (utils/bookingPayments.js): the venue's company's
 * own account, an invoice named after the spot's code (`play-<signupCode>`),
 * and money believed only once the invoice is read back from Xendit.
 * settleInvoice() in bookingPayments.js hands `play-` invoices to
 * settlePlayInvoice() here; its refunds go through the shared sendRefunds().
 */

const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";
const FORMAT = "YYYY-MM-DD HH:mm:ss";

const fail = (status, message, code) => ({ ok: false, status, message, code });
const cents = (amount) => Math.round(Number(amount) * 100);
const secondsUntil = (localTime, now) =>
  moment.tz(localTime, FORMAT, TIMEZONE).diff(moment.tz(now, FORMAT, TIMEZONE), "seconds");
const clock = (localTime) => moment.tz(localTime, FORMAT, TIMEZONE).format("h:mm A");

/** Our reference on a spot's Xendit invoice. */
export const playInvoiceExternalId = (signupCode) => `play-${signupCode}`;

const loadSpot = async (db, playSignupId) => {
  const rows = await db.query(
    `SELECT su.playSignupId, su.signupCode, su.price, su.email, su.holdExpiresAt, su.status,
            su.paymentStatus, su.checkoutId, su.checkoutUrl,
            s.playToken, s.title, s.startAt, s.endAt, s.venueId, v.name AS venueName
     FROM play_signups su
     JOIN play_sessions s ON s.playSessionId = su.playSessionId
     JOIN venues v ON v.venueId = s.venueId
     WHERE su.playSignupId = ? LIMIT 1`,
    [playSignupId]
  );
  return rows[0] || null;
};

/**
 * Open a Xendit checkout for a held spot (Pending, Unpaid) and remember it.
 * Outside a transaction: it calls Xendit.
 * @returns {Promise<{ ok: true, checkoutUrl } | { ok: false, status, message }>}
 */
export const openPlayCheckout = async (db, playSignupId) => {
  const now = getCurrentTimestampLocal();
  const spot = await loadSpot(db, playSignupId);
  if (!spot || spot.status !== "Pending" || spot.paymentStatus !== "Unpaid") {
    return fail(409, "This spot isn't waiting for payment");
  }
  const account = await paymentAccountForVenue(db, spot.venueId);
  if (!xendit.isOnlinePaymentOn(account)) {
    return fail(409, "Online payment isn't available here — please ask the venue");
  }
  const seconds = spot.holdExpiresAt ? secondsUntil(spot.holdExpiresAt, now) : 0;
  if (seconds < MIN_CHECKOUT_SECONDS) {
    return fail(409, "The hold on your spot is running out — join again");
  }

  let invoice;
  try {
    invoice = await xendit.createInvoice(
      {
        externalId: playInvoiceExternalId(spot.signupCode),
        amount: Number(spot.price),
        durationSeconds: seconds,
        returnUrl: `${openPlayUrl(spot.playToken)}?checkout=done`,
        email: spot.email,
        description: `${spot.venueName} · Open Play: ${spot.title} · ${spot.startAt.slice(0, 10)} ${clock(
          spot.startAt
        )}–${clock(spot.endAt)} · Spot ${spot.signupCode}`,
      },
      account
    );
  } catch (err) {
    logger.error("Xendit: could not open an Open Play checkout", { playSignupId, error: err.message });
    return fail(502, "Online payment isn't working right now — try again in a minute");
  }

  const updated = await db.query(
    `UPDATE play_signups SET checkoutId = ?, checkoutUrl = ?, dateUpdated = ?
     WHERE playSignupId = ? AND status = 'Pending' AND paymentStatus = 'Unpaid'`,
    [invoice.id, invoice.url, getCurrentTimestampLocal(), playSignupId]
  );
  if (Number(updated?.affectedRows || 0) === 0) {
    await expireCheckout(invoice.id, account);
    return fail(409, "This spot isn't waiting for payment");
  }
  return { ok: true, checkoutUrl: invoice.url };
};

/**
 * The player's "Pay": the open checkout while the hold lasts (one that turns
 * out to be paid is settled here), else a new one.
 */
export const resumePlayCheckout = async (db, playSignupId) => {
  const spot = await loadSpot(db, playSignupId);
  if (!spot) return fail(404, "Spot not found");
  if (spot.paymentStatus === "Paid" || spot.paymentStatus === "Free") return { ok: true, paid: true };
  if (spot.status !== "Pending") return fail(409, "This spot isn't waiting for payment — join again");
  if (spot.checkoutId) {
    const account = await paymentAccountForVenue(db, spot.venueId);
    try {
      const invoice = await xendit.getInvoice(spot.checkoutId, account);
      if (invoice.paid) {
        const settled = await settleInvoice(db, invoice.id, { invoice, account });
        return { ok: true, paid: settled.outcome === "CONFIRMED", outcome: settled.outcome };
      }
      if (invoice.status === "PENDING" && spot.checkoutUrl) return { ok: true, checkoutUrl: spot.checkoutUrl };
    } catch (err) {
      logger.warn("Xendit: could not read an Open Play checkout", { playSignupId, error: err.message });
    }
  }
  return openPlayCheckout(db, playSignupId);
};

/** Lock a spot by its code, its session row first (the lock order every spot writer uses). */
const lockSpotByCode = async (conn, signupCode) => {
  const [peek] = await conn.execute(`SELECT playSessionId FROM play_signups WHERE signupCode = ? LIMIT 1`, [
    signupCode,
  ]);
  if (!peek.length) return null;
  const [sessions] = await conn.execute(
    `SELECT s.*, v.companyId FROM play_sessions s JOIN venues v ON v.venueId = s.venueId
     WHERE s.playSessionId = ? LIMIT 1 FOR UPDATE`,
    [peek[0].playSessionId]
  );
  const [spots] = await conn.execute(`SELECT * FROM play_signups WHERE signupCode = ? LIMIT 1 FOR UPDATE`, [
    signupCode,
  ]);
  return spots[0] ? { spot: spots[0], session: sessions[0] } : null;
};

/** Should this paid invoice keep the spot? Otherwise the money goes back. */
const decide = async (conn, { spot, session }, invoice, now) => {
  if (cents(invoice.amount) !== cents(spot.price)) return { keep: false, reason: "OTHERS", why: "AMOUNT_MISMATCH" };
  if (spot.paymentStatus !== "Unpaid") return { keep: false, reason: "DUPLICATE", why: "ALREADY_PAID" };
  if (session.status !== "Scheduled") return { keep: false, reason: "CANCELLATION", why: "SESSION_CANCELLED" };
  if (session.endAt <= now) return { keep: false, reason: "CANCELLATION", why: "SESSION_OVER" };
  if (spot.status === "Pending" && spot.holdExpiresAt && spot.holdExpiresAt > now) return { keep: true };
  // Paid after the hold ran out: still theirs if a spot is free
  if (["Pending", "Expired"].includes(spot.status)) {
    const taken = await liveSpots(conn, session.playSessionId, now, { exceptSignupId: spot.playSignupId });
    if (taken < session.capacity) return { keep: true };
    return { keep: false, reason: "CANCELLATION", why: "SESSION_FULL" };
  }
  return { keep: false, reason: "CANCELLATION", why: `SPOT_${String(spot.status).toUpperCase()}` };
};

/**
 * A paid `play-<code>` invoice → one payment row (once per invoice), then the
 * spot Confirmed / Paid — or a full refund when it can't have it.
 * @param {string|null} companyId - a company's own webhook: the spot must be at its venue
 */
export const settlePlayInvoice = async (db, invoice, signupCode, companyId = null) => {
  const now = getCurrentTimestampLocal();
  let conn;
  let decision;
  let paymentId;
  let playSignupId;
  try {
    conn = await db.beginTransaction();
    const found = await lockSpotByCode(conn, signupCode);
    if (!found) {
      await db.rollback(conn);
      logger.warn("Xendit: a paid invoice for no Open Play spot", { invoiceId: invoice.id, signupCode });
      return { outcome: "UNKNOWN_BOOKING" };
    }
    if (companyId && found.session.companyId !== companyId) {
      await db.rollback(conn);
      logger.warn("Xendit: a company's invoice names another company's Open Play spot", { invoiceId: invoice.id });
      return { outcome: "WRONG_COMPANY" };
    }
    const [existing] = await conn.execute(`SELECT paymentId FROM payments WHERE providerRef = ? LIMIT 1`, [
      invoice.id,
    ]);
    if (existing.length) {
      await db.rollback(conn);
      return { outcome: "ALREADY_RECORDED" };
    }
    playSignupId = found.spot.playSignupId;
    decision = await decide(conn, found, invoice, now);
    const [uuid] = await conn.execute(`SELECT UUID() AS id`);
    paymentId = uuid[0].id;
    await conn.execute(
      `INSERT INTO payments
         (paymentId, playSignupId, venueId, amount, method, provider, providerRef, refundError, note,
          status, paidAt, dateCreated, dateUpdated)
       VALUES (?, ?, ?, ?, 'ONLINE', 'xendit', ?, ?, ?, 'Paid', ?, ?, ?)`,
      [
        paymentId,
        playSignupId,
        found.session.venueId,
        invoice.amount,
        invoice.id,
        decision.keep ? null : REFUND_QUEUED,
        decision.keep ? `Open Play spot ${signupCode}` : `Open Play spot ${signupCode} — paid but not kept (${decision.why}), refunded`,
        now,
        now,
        now,
      ]
    );
    if (decision.keep) {
      await conn.execute(
        `UPDATE play_signups
         SET status = 'Confirmed', paymentStatus = 'Paid', holdExpiresAt = NULL, checkoutId = NULL,
             checkoutUrl = NULL, dateUpdated = ?
         WHERE playSignupId = ?`,
        [now, playSignupId]
      );
    } else {
      await conn.execute(
        `UPDATE play_signups
         SET status = IF(status = 'Pending', 'Expired', status),
             checkoutId = IF(checkoutId = ?, NULL, checkoutId),
             checkoutUrl = IF(checkoutId IS NULL, NULL, checkoutUrl),
             dateUpdated = ?
         WHERE playSignupId = ?`,
        [invoice.id, now, playSignupId]
      );
    }
    await db.commit(conn);
  } catch (err) {
    await db.rollback(conn);
    if (err.code === "ER_DUP_ENTRY") return { outcome: "ALREADY_RECORDED" };
    throw err;
  }

  if (decision.keep) {
    await sendPlayEmail(db, playSignupId, "Confirmed");
    return { outcome: "CONFIRMED" };
  }
  logger.warn("Xendit: refunding an Open Play payment the spot can't keep", { paymentId, why: decision.why });
  const [sent] = await sendRefunds(db, { paymentIds: [paymentId], reason: decision.reason });
  await sendPlayEmail(db, playSignupId, "PaymentRefunded", {
    why: decision.why,
    amount: Number(invoice.amount),
    refunded: Boolean(sent?.ok),
  });
  return { outcome: sent?.ok ? "REFUNDED" : "REFUND_FAILED", why: decision.why };
};
