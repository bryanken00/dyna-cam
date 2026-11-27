import { logger } from "../../config/logger.js";
import { directionsUrl } from "./maps.js";
import { sendgridConfigured, sendMail } from "../lib/mailer/mailer.js";
import {
  openPlayCancelledEmail,
  openPlayConfirmedEmail,
  openPlayPaymentRefundedEmail,
  openPlayReminderEmail,
} from "../lib/mailer/templates.js";
import { openPlayUrl } from "./clips.js";
import { getCurrentTimestampLocal, moment } from "./dateUtils.js";
import { bookingReminderMinutes } from "./bookingEmails.js";
import { firstName } from "./openPlay.js";

/**
 * PLAN-009 phase C — a player's Open Play emails, the same way booking emails
 * go (utils/bookingEmails.js): after the commit of the request that causes
 * them, never failing it, once-only ones claimed on their column first.
 *
 *   Confirmed        the spot is paid or free                once (confirmationSentAt)
 *   Reminder         BOOKING_REMINDER_MINUTES before          once (reminderSentAt) — the job
 *   Cancelled        by the player, staff, or the session     once (cancelledEmailSentAt)
 *   PaymentRefunded  a payment the spot couldn't keep
 *
 * A walk-in (no email) gets none.
 */

const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";
const FORMAT = "YYYY-MM-DD HH:mm:ss";
const local = (value) => moment.tz(value, FORMAT, TIMEZONE);
const peso = (amount) => `₱${Number(amount).toLocaleString("en-PH")}`;

const ONCE = { Confirmed: "confirmationSentAt", Reminder: "reminderSentAt", Cancelled: "cancelledEmailSentAt" };

const loadSpot = async (db, playSignupId) => {
  const [row] = await db.query(
    `SELECT su.playSignupId, su.signupCode, su.email, su.price, su.paymentStatus, su.status, su.cancelledBy,
            COALESCE(p.name, su.walkInName) AS playerName,
            s.playToken, s.title, s.startAt, s.endAt, s.status AS sessionStatus, s.cancelReason,
            v.name AS venueName, v.latitude, v.longitude,
            (SELECT GROUP_CONCAT(c.name ORDER BY c.name SEPARATOR ', ')
             FROM play_session_courts pc JOIN courts c ON c.courtId = pc.courtId
             WHERE pc.playSessionId = s.playSessionId) AS courts
     FROM play_signups su
     JOIN play_sessions s ON s.playSessionId = su.playSessionId
     JOIN venues v ON v.venueId = s.venueId
     LEFT JOIN players p ON p.playerId = su.playerId
     WHERE su.playSignupId = ? AND su.status != 'Deleted' LIMIT 1`,
    [playSignupId]
  );
  return row || null;
};

const facts = (s) => ({
  playerName: firstName(s.playerName),
  title: s.title,
  venueName: s.venueName,
  courts: s.courts || "Courts",
  day: local(s.startAt).format("ddd, MMM D"),
  time: `${local(s.startAt).format("h:mm A")} – ${local(s.endAt).format("h:mm A")}`,
  sessionUrl: openPlayUrl(s.playToken),
  directionsUrl: directionsUrl(s.latitude, s.longitude),
});

const startsIn = (s, now) => {
  const minutes = Math.max(0, Math.round(local(s.startAt).diff(local(now), "minutes", true)));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const parts = [];
  if (hours) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (rest || !hours) parts.push(`${rest} minute${rest === 1 ? "" : "s"}`);
  return `in ${parts.join(" ")}`;
};

const REFUNDED_WHY = {
  SESSION_FULL: "your payment came in after the hold on your spot ran out, and the session filled up meanwhile.",
  SESSION_CANCELLED: "the venue cancelled this session before your payment came in.",
  SESSION_OVER: "your payment came in after the session ended.",
  ALREADY_PAID: "this spot was already paid, so your second payment isn't needed.",
  AMOUNT_MISMATCH: "the session's price changed after you opened the payment page. Join again to pay the new price.",
};

/** What a cancelled spot's money does. */
const refundLine = async (db, s) => {
  if (s.paymentStatus !== "Paid" && s.paymentStatus !== "Refunded") return null;
  const payments = await db.query(
    `SELECT amount, status, refundError FROM payments WHERE playSignupId = ? ORDER BY dateCreated DESC LIMIT 1`,
    [s.playSignupId]
  );
  const pay = payments[0];
  if (!pay) return null;
  if (pay.status === "Refunded") {
    return `${peso(pay.amount)} is being refunded to the account you paid with. It can take a few days to show.`;
  }
  if (pay.refundError) return `We couldn't refund ${peso(pay.amount)} automatically — the venue will contact you.`;
  return null;
};

const cancelledWhy = (s) => {
  if (s.sessionStatus === "Cancelled") {
    return `the venue cancelled this session${s.cancelReason ? ` (${s.cancelReason})` : ""}.`;
  }
  return s.cancelledBy === "Player" ? "your spot is cancelled, as you asked." : "the venue cancelled your spot.";
};

const BUILDERS = {
  Confirmed: (db, s, f) =>
    openPlayConfirmedEmail({
      ...f,
      paidLine: s.paymentStatus === "Paid" ? `You paid ${peso(s.price)}` : "It's free",
    }),
  Reminder: (db, s, f, extra) => openPlayReminderEmail({ ...f, startsIn: startsIn(s, extra.now) }),
  Cancelled: async (db, s, f) =>
    openPlayCancelledEmail({ ...f, why: cancelledWhy(s), refundLine: await refundLine(db, s) }),
  PaymentRefunded: (db, s, f, extra) =>
    openPlayPaymentRefundedEmail({
      ...f,
      why: REFUNDED_WHY[extra.why] || "this spot couldn't take your payment.",
      refundLine: extra.refunded
        ? `${peso(extra.amount)} is being refunded to the account you paid with. It can take a few days to show.`
        : `We couldn't refund ${peso(extra.amount)} automatically — the venue will contact you.`,
    }),
};

/**
 * Email the player about their spot. Never throws.
 * @param {"Confirmed"|"Reminder"|"Cancelled"|"PaymentRefunded"} kind
 * @returns {Promise<{ sent: boolean, reason?: string }>}
 */
export const sendPlayEmail = async (db, playSignupId, kind, extra = {}) => {
  try {
    const s = await loadSpot(db, playSignupId);
    if (!s) return { sent: false, reason: "NOT_FOUND" };
    if (!s.email) return { sent: false, reason: "NO_EMAIL" };
    const mail = await BUILDERS[kind]?.(db, s, facts(s), { now: getCurrentTimestampLocal(), ...extra });
    if (!mail) return { sent: false, reason: "NOT_APPLICABLE" };

    const configured = sendgridConfigured();
    const column = ONCE[kind];
    if (column && configured) {
      const claimed = await db.query(
        `UPDATE play_signups SET ${column} = ? WHERE playSignupId = ? AND ${column} IS NULL`,
        [getCurrentTimestampLocal(), s.playSignupId]
      );
      if (Number(claimed?.affectedRows || 0) === 0) return { sent: false, reason: "ALREADY_SENT" };
    }
    const { sent } = await sendMail({ to: s.email, subject: mail.subject, html: mail.html });
    if (!configured) return { sent: false, reason: "NOT_SET_UP" };
    if (!sent) return { sent: false, reason: "FAILED" };
    return { sent: true };
  } catch (err) {
    logger.error("Open Play email failed", { playSignupId, kind, error: err.message });
    return { sent: false, reason: "FAILED" };
  }
};

/** The minute job: reminders for Confirmed spots whose session starts soon. */
export const runPlayEmails = async (db, { now = getCurrentTimestampLocal() } = {}) => {
  if (!sendgridConfigured()) return { reminders: 0 };
  const until = local(now).add(bookingReminderMinutes(), "minutes").format(FORMAT);
  const due = await db.query(
    `SELECT su.playSignupId FROM play_signups su
     JOIN play_sessions s ON s.playSessionId = su.playSessionId
     WHERE su.status = 'Confirmed' AND su.reminderSentAt IS NULL AND su.email IS NOT NULL
       AND s.status = 'Scheduled' AND s.startAt > ? AND s.startAt <= ?
       -- spots taken in the reminder window already got their confirmation
       AND su.dateCreated < DATE_SUB(s.startAt, INTERVAL ? MINUTE)`,
    [now, until, bookingReminderMinutes()]
  );
  let reminders = 0;
  for (const row of due) {
    const done = await sendPlayEmail(db, row.playSignupId, "Reminder", { now });
    if (done.sent) reminders += 1;
  }
  return { reminders };
};
