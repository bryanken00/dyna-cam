import { logger } from "../../config/logger.js";
import { sendgridConfigured, sendMail } from "../lib/mailer/mailer.js";
import {
  bookingCancelledEmail,
  bookingConfirmedEmail,
  bookingGameStartedEmail,
  bookingMovedEmail,
  bookingOrderConfirmedEmail,
  bookingPayLinkEmail,
  bookingPaymentRefundedEmail,
  bookingReminderEmail,
} from "../lib/mailer/templates.js";
import { bookingManageUrl, sessionShareUrl } from "./clips.js";
import { getCurrentTimestampLocal, moment } from "./dateUtils.js";

/**
 * PLAN-003 Phase G — the player's booking emails, through lib/mailer
 * (SendGrid when SENDGRID_API_KEY is set; otherwise written to the log).
 *
 *   Confirmed        the booking is paid or free             once (confirmationSentAt)
 *   PayAtDesk        held from the desk: a pay link, to pay      at creation
 *                    online by a deadline (CR-046)
 *   Reminder         BOOKING_REMINDER_MINUTES before          once (reminderSentAt) — the job
 *   Cancelled        by staff, a closure (later: the player)  once (cancelledEmailSentAt)
 *   Released         an unpaid hold ran out                   once (cancelledEmailSentAt) — the job
 *   Moved            new time / court                         each move
 *   GameStarted      checked in: the game page link           at check-in
 *   PaymentRefunded  an online payment the booking couldn't keep
 *
 * The request that causes an email sends it after its commit; sendBookingEmail()
 * never throws, so an email can't break the request. The once-only emails are
 * claimed on their column first (so the request and the job never both send
 * one). A booking without an email gets none — email is optional at the desk.
 * Without SendGrid the email is only logged and nothing is recorded as sent.
 */

const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";
const FORMAT = "YYYY-MM-DD HH:mm:ss";

/** Minutes before the start that the reminder goes out (default 2 hours). */
export const bookingReminderMinutes = () => {
  const value = parseInt(process.env.BOOKING_REMINDER_MINUTES || "120", 10);
  return Number.isFinite(value) && value > 0 ? value : 120;
};

/** Emails sent only once, and the column that records it. */
const ONCE = {
  Confirmed: "confirmationSentAt",
  Reminder: "reminderSentAt",
  Cancelled: "cancelledEmailSentAt",
  Released: "cancelledEmailSentAt",
};

const local = (value) => moment.tz(value, FORMAT, TIMEZONE);
const clock = (value) => local(value).format("h:mm A");
const peso = (amount) => `₱${Number(amount).toLocaleString("en-PH")}`;

const loadBooking = async (db, bookingId) => {
  const [row] = await db.query(
    `SELECT b.bookingId, b.bookingCode, b.manageToken, b.startAt, b.endAt, b.playerName, b.email,
            b.price, b.paymentStatus, b.payMethod, b.holdExpiresAt, b.status, b.cancelledBy,
            c.name AS courtName, v.name AS venueName, v.checkInEarlyMinutes,
            s.shareToken, s.status AS gameStatus
     FROM bookings b
     JOIN courts c ON c.courtId = b.courtId
     JOIN venues v ON v.venueId = b.venueId
     LEFT JOIN recording_sessions s ON s.sessionId = b.sessionId
     WHERE b.bookingId = ? AND b.status != 'Deleted'
     LIMIT 1`,
    [bookingId]
  );
  return row || null;
};

/** The facts every booking email shows. */
const facts = (b) => ({
  playerName: b.playerName,
  venueName: b.venueName,
  courtName: b.courtName,
  day: local(b.startAt).format("ddd, MMM D, YYYY"),
  time: `${clock(b.startAt)} – ${clock(b.endAt)}`,
  bookingCode: b.bookingCode,
  price: peso(b.price),
  manageUrl: bookingManageUrl(b.manageToken),
});

const checkInFrom = (b) =>
  clock(local(b.startAt).subtract(b.checkInEarlyMinutes, "minutes").format(FORMAT));

/** "in 2 hours", "in 45 minutes", "in 1 hour 30 minutes". */
const startsIn = (b, now) => {
  const minutes = Math.max(0, Math.round(local(b.startAt).diff(local(now), "minutes", true)));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const parts = [];
  if (hours) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (rest || !hours) parts.push(`${rest} minute${rest === 1 ? "" : "s"}`);
  return `in ${parts.join(" ")}`;
};

/** What a cancelled booking's money does, in the player's words. */
const refundLines = (payments) =>
  payments.map((pay) => {
    const amount = peso(pay.amount);
    if (pay.status === "Refunded") {
      return pay.method === "ONLINE"
        ? `${amount} is being refunded to the account you paid with. It can take a few days to show.`
        : `Your ${amount} paid at the desk is refunded by the venue.`;
    }
    if (pay.refundError) {
      return `We couldn't refund ${amount} automatically — the venue will contact you to give it back.`;
    }
    return `What you paid (${amount}) wasn't refunded — contact the venue if you have questions.`;
  });

const CANCELLED_WHY = {
  Staff: "the venue cancelled your booking.",
  Player: "your booking is cancelled, as you asked.",
  System: "your booking was cancelled.",
};

const REFUNDED_WHY = {
  SLOT_TAKEN:
    "your payment came in after the hold on this court ran out, and someone else booked it meanwhile.",
  ALREADY_PAID: "this booking was already paid, so your second payment isn't needed.",
  AMOUNT_MISMATCH:
    "the booking's price changed after you opened the payment page, so that payment couldn't be used. Open your booking to pay the new price.",
};

const paidLine = (b, f) =>
  b.paymentStatus === "Free"
    ? "It's free"
    : `Paid ${f.price} ${b.payMethod === "Online" ? "online" : "at the desk"}`;

const cancelledPayments = (db, bookingId) =>
  db.query(
    `SELECT amount, method, status, refundError FROM payments
     WHERE bookingId = ? AND status IN ('Paid', 'Refunded') ORDER BY paidAt ASC`,
    [bookingId]
  );

/**
 * One builder per email: (db, booking, facts, extra) → { subject, html }, or
 * null when it no longer applies (the booking moved on meanwhile).
 */
const BUILDERS = {
  Confirmed: (db, b, f) =>
    b.status === "Confirmed"
      ? bookingConfirmedEmail({ ...f, paidLine: paidLine(b, f), checkInFrom: checkInFrom(b) })
      : null,
  PayAtDesk: (db, b, f) =>
    b.status === "Pending" && b.payMethod === "Desk" && b.holdExpiresAt
      ? bookingPayLinkEmail({
          ...f,
          payBy: local(b.holdExpiresAt).format("h:mm A, ddd MMM D"),
        })
      : null,
  Reminder: (db, b, f, extra) =>
    b.status === "Confirmed"
      ? bookingReminderEmail({
          ...f,
          startsIn: startsIn(b, extra.now || getCurrentTimestampLocal()),
          checkInFrom: checkInFrom(b),
        })
      : null,
  Cancelled: async (db, b, f, extra) =>
    b.status === "Cancelled"
      ? bookingCancelledEmail({
          ...f,
          title: "Your booking was cancelled",
          why: extra.why || CANCELLED_WHY[b.cancelledBy] || CANCELLED_WHY.System,
          refundLines: refundLines(await cancelledPayments(db, b.bookingId)),
        })
      : null,
  Released: (db, b, f) =>
    b.status === "Expired"
      ? bookingCancelledEmail({
          ...f,
          title: "Your court was released",
          why: "your booking wasn't paid in time, so the court was released for others to book.",
          refundLines: [],
        })
      : null,
  Moved: (db, b, f, extra) =>
    ["Pending", "Confirmed"].includes(b.status) && extra.previous
      ? bookingMovedEmail({ ...f, previous: extra.previous })
      : null,
  GameStarted: (db, b, f) =>
    b.shareToken
      ? bookingGameStartedEmail({
          ...f,
          gameUrl: sessionShareUrl(b.shareToken),
          recordingFrom: b.gameStatus === "Scheduled" ? `from ${clock(b.startAt)}` : "from now",
        })
      : null,
  PaymentRefunded: (db, b, f, extra) =>
    bookingPaymentRefundedEmail({
      ...f,
      why: REFUNDED_WHY[extra.why] || "this booking was cancelled before your payment came in.",
      refundLine: extra.refunded
        ? `${peso(extra.amount)} is being refunded to the account you paid with. It can take a few days to show.`
        : `We couldn't refund ${peso(extra.amount)} automatically — the venue will contact you to give it back.`,
    }),
};

const build = (db, kind, b, extra) => {
  const builder = BUILDERS[kind];
  return builder ? builder(db, b, facts(b), extra) : null;
};

/**
 * Email the player about their booking. Never throws.
 *
 * @param db - req.db (outside any transaction: call it after commit)
 * @param {string} bookingId
 * @param {"Confirmed"|"PayAtDesk"|"Reminder"|"Cancelled"|"Released"|"Moved"|"GameStarted"
 *   |"PaymentRefunded"} kind
 * @param {Object} [extra]
 * @param {boolean} [extra.force] - send a once-only email again (Admin Resend)
 * @param {string} [extra.why] - Cancelled: the sentence after "Hi," · PaymentRefunded: the reason code
 * @param {string} [extra.previous] - Moved: where and when it was
 * @param {number} [extra.amount] / {boolean} [extra.refunded] - PaymentRefunded
 * @param {string} [extra.now] - the job's clock
 * @returns {Promise<{ sent: boolean, reason?: string, to?: string }>}
 *   reason: NOT_FOUND · NO_EMAIL · NOT_APPLICABLE · ALREADY_SENT · NOT_SET_UP (logged only) · FAILED
 */
export const sendBookingEmail = async (db, bookingId, kind, extra = {}) => {
  try {
    const b = await loadBooking(db, bookingId);
    if (!b) return { sent: false, reason: "NOT_FOUND" };
    if (!b.email) return { sent: false, reason: "NO_EMAIL" };
    const mail = await build(db, kind, b, extra);
    if (!mail) return { sent: false, reason: "NOT_APPLICABLE" };

    const configured = sendgridConfigured();
    const column = ONCE[kind];
    if (column && configured) {
      const now = getCurrentTimestampLocal();
      const claimed = await db.query(
        `UPDATE bookings SET ${column} = ? WHERE bookingId = ?${extra.force ? "" : ` AND ${column} IS NULL`}`,
        [now, b.bookingId]
      );
      if (Number(claimed?.affectedRows || 0) === 0) return { sent: false, reason: "ALREADY_SENT" };
    }

    // A refused send keeps its claim: it isn't retried, so a bad address isn't mailed every minute
    const { sent } = await sendMail({ to: b.email, subject: mail.subject, html: mail.html });
    if (!configured) return { sent: false, reason: "NOT_SET_UP" };
    if (!sent) {
      logger.warn("Booking email failed", { bookingCode: b.bookingCode, kind });
      return { sent: false, reason: "FAILED" };
    }
    return { sent: true, to: b.email };
  } catch (err) {
    logger.error("Booking email failed", { bookingId, kind, error: err.message });
    return { sent: false, reason: "FAILED" };
  }
};

/**
 * CR-047: bookings paid together in one checkout → one confirmation listing
 * them all. Each booking's confirmationSentAt is claimed first (so it's never
 * also mailed on its own); one booking alone gets the usual confirmation.
 * Never throws.
 *
 * @param db - req.db (after commit)
 * @param {string[]} bookingIds - Confirmed bookings of one order
 */
export const sendOrderConfirmedEmail = async (db, bookingIds) => {
  if (bookingIds.length === 1) return sendBookingEmail(db, bookingIds[0], "Confirmed");
  try {
    const rows = [];
    for (const id of bookingIds) {
      const b = await loadBooking(db, id);
      if (b && b.status === "Confirmed" && b.email) rows.push(b);
    }
    if (rows.length === 0) return { sent: false, reason: "NO_EMAIL" };
    const configured = sendgridConfigured();
    let mine = rows;
    if (configured) {
      const now = getCurrentTimestampLocal();
      mine = [];
      for (const b of rows) {
        const claimed = await db.query(
          `UPDATE bookings SET confirmationSentAt = ? WHERE bookingId = ? AND confirmationSentAt IS NULL`,
          [now, b.bookingId]
        );
        if (Number(claimed?.affectedRows || 0) > 0) mine.push(b);
      }
      if (mine.length === 0) return { sent: false, reason: "ALREADY_SENT" };
    }
    mine.sort((a, b) => (a.startAt < b.startAt ? -1 : a.startAt > b.startAt ? 1 : a.courtName.localeCompare(b.courtName)));
    const total = mine.reduce((sum, b) => sum + Number(b.price), 0);
    const mail = bookingOrderConfirmedEmail({
      playerName: mine[0].playerName,
      venueName: mine[0].venueName,
      day: local(mine[0].startAt).format("ddd, MMM D, YYYY"),
      paidLine: `Paid ${peso(total)} online`,
      items: mine.map((b) => ({
        courtName: b.courtName,
        time: `${clock(b.startAt)} – ${clock(b.endAt)}`,
        manageUrl: bookingManageUrl(b.manageToken),
        checkInFrom: checkInFrom(b),
      })),
    });
    const { sent } = await sendMail({ to: mine[0].email, subject: mail.subject, html: mail.html });
    if (!configured) return { sent: false, reason: "NOT_SET_UP" };
    return sent ? { sent: true, to: mine[0].email } : { sent: false, reason: "FAILED" };
  } catch (err) {
    logger.error("Order confirmation email failed", { error: err.message });
    return { sent: false, reason: "FAILED" };
  }
};

/** "Court 1 · Tue, Nov 24, 5:00 PM – 6:00 PM" — where a booking was, for the Moved email. */
export const describeSlot = async (db, { courtId, startAt, endAt }) => {
  const [court] = await db.query(`SELECT name FROM courts WHERE courtId = ? LIMIT 1`, [courtId]);
  return `${court?.name || "Court"} · ${local(startAt).format("ddd, MMM D")}, ${clock(startAt)} – ${clock(endAt)}`;
};

/** After a create: confirmed → the confirmation; a desk hold → the pay-by email. */
export const sendCreatedEmail = (db, { bookingId, status }) =>
  sendBookingEmail(db, bookingId, status === "Confirmed" ? "Confirmed" : "PayAtDesk");

/**
 * The booking job's emails (needs SendGrid — without it they'd only be logged
 * every minute): reminders for Confirmed bookings starting within
 * BOOKING_REMINDER_MINUTES (skipped when the confirmation itself went out that
 * close to the start), and "your court was released" for holds that ran out in
 * the last hour.
 *
 * @returns {Promise<{ reminders: number, released: number }>}
 */
export const runBookingEmails = async (
  db,
  { now = getCurrentTimestampLocal(), limit = 50 } = {}
) => {
  const tally = { reminders: 0, released: 0 };
  if (!sendgridConfigured()) return tally;
  const minutes = bookingReminderMinutes();
  const remindFrom = local(now).add(minutes, "minutes").format(FORMAT);
  const releasedSince = local(now).subtract(60, "minutes").format(FORMAT);
  const max = Math.max(1, Math.min(200, Number(limit) || 50));

  const reminders = await db.query(
    `SELECT bookingId FROM bookings
     WHERE status = 'Confirmed' AND reminderSentAt IS NULL AND email IS NOT NULL
       AND startAt > ? AND startAt <= ?
       AND (confirmationSentAt IS NULL OR confirmationSentAt <= DATE_SUB(startAt, INTERVAL ${minutes} MINUTE))
     ORDER BY startAt ASC
     LIMIT ${max}`,
    [now, remindFrom]
  );
  for (const row of reminders) {
    const result = await sendBookingEmail(db, row.bookingId, "Reminder", { now });
    if (result.sent) tally.reminders += 1;
  }

  const released = await db.query(
    `SELECT bookingId FROM bookings
     WHERE status = 'Expired' AND cancelledEmailSentAt IS NULL AND email IS NOT NULL
       AND holdExpiresAt > ? AND holdExpiresAt <= ?
     ORDER BY holdExpiresAt ASC
     LIMIT ${max}`,
    [releasedSince, now]
  );
  for (const row of released) {
    const result = await sendBookingEmail(db, row.bookingId, "Released");
    if (result.sent) tally.released += 1;
  }
  return tally;
};
