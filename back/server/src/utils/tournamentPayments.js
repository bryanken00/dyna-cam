import { logger } from "../../config/logger.js";
import * as xendit from "../lib/payments/xendit.js";
import { paymentAccountForVenue } from "./companyPayments.js";
import { getCurrentTimestampLocal, moment } from "./dateUtils.js";
import { tournamentUrl } from "./clips.js";
import {
  expireCheckout,
  MIN_CHECKOUT_SECONDS,
  REFUND_QUEUED,
  sendRefunds,
  settleInvoice,
} from "./bookingPayments.js";
import { registerIfComplete } from "./tournaments.js";
import { sendTournamentEmail } from "./tournamentEmails.js";

/**
 * PLAN-009 phase E — paying a team's entry fee online: the same Xendit flow as
 * bookings and Open Play (the venue's company's account; believed only once
 * read back from Xendit). The invoice is named after the team's code,
 * `team-<teamCode>`; settleInvoice() in bookingPayments.js hands those here.
 * The captain pays for the whole team.
 */

const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";
const FORMAT = "YYYY-MM-DD HH:mm:ss";
const fail = (status, message) => ({ ok: false, status, message });
const cents = (amount) => Math.round(Number(amount) * 100);
const secondsUntil = (localTime, now) =>
  moment.tz(localTime, FORMAT, TIMEZONE).diff(moment.tz(now, FORMAT, TIMEZONE), "seconds");

export const teamInvoiceExternalId = (teamCode) => `team-${teamCode}`;

const loadTeam = async (db, tournamentTeamId) => {
  const rows = await db.query(
    `SELECT tt.tournamentTeamId, tt.teamCode, tt.name, tt.price, tt.email, tt.holdExpiresAt, tt.status,
            tt.paymentStatus, tt.checkoutId, tt.checkoutUrl, d.name AS divisionName, t.publicToken,
            t.name AS tournamentName, t.venueId
     FROM tournament_teams tt
     JOIN tournament_divisions d ON d.divisionId = tt.divisionId
     JOIN tournaments t ON t.tournamentId = d.tournamentId
     WHERE tt.tournamentTeamId = ? LIMIT 1`,
    [tournamentTeamId]
  );
  return rows[0] || null;
};

/** Open a checkout for a held entry (Pending, Unpaid). Outside a transaction: it calls Xendit. */
export const openTeamCheckout = async (db, tournamentTeamId) => {
  const now = getCurrentTimestampLocal();
  const team = await loadTeam(db, tournamentTeamId);
  if (!team || team.status !== "Pending" || team.paymentStatus !== "Unpaid") {
    return fail(409, "This entry isn't waiting for payment");
  }
  const account = await paymentAccountForVenue(db, team.venueId);
  if (!xendit.isOnlinePaymentOn(account)) return fail(409, "Online payment isn't available here — please ask the venue");
  const seconds = team.holdExpiresAt ? secondsUntil(team.holdExpiresAt, now) : 0;
  if (seconds < MIN_CHECKOUT_SECONDS) return fail(409, "The hold on your entry is running out — register again");

  let invoice;
  try {
    invoice = await xendit.createInvoice(
      {
        externalId: teamInvoiceExternalId(team.teamCode),
        amount: Number(team.price),
        durationSeconds: seconds,
        returnUrl: `${tournamentUrl(team.publicToken)}?checkout=done`,
        email: team.email,
        description: `${team.tournamentName} · ${team.divisionName} · Team ${team.name} · Entry ${team.teamCode}`.slice(0, 255),
      },
      account
    );
  } catch (err) {
    logger.error("Xendit: could not open a tournament checkout", { tournamentTeamId, error: err.message });
    return fail(502, "Online payment isn't working right now — try again in a minute");
  }
  const updated = await db.query(
    `UPDATE tournament_teams SET checkoutId = ?, checkoutUrl = ?, dateUpdated = ?
     WHERE tournamentTeamId = ? AND status = 'Pending' AND paymentStatus = 'Unpaid'`,
    [invoice.id, invoice.url, getCurrentTimestampLocal(), tournamentTeamId]
  );
  if (Number(updated?.affectedRows || 0) === 0) {
    await expireCheckout(invoice.id, account);
    return fail(409, "This entry isn't waiting for payment");
  }
  return { ok: true, checkoutUrl: invoice.url };
};

/** The captain's "Pay": the open checkout (settled here if paid), else a new one. */
export const resumeTeamCheckout = async (db, tournamentTeamId) => {
  const team = await loadTeam(db, tournamentTeamId);
  if (!team) return fail(404, "Entry not found");
  if (team.paymentStatus === "Paid" || team.paymentStatus === "Free") return { ok: true, paid: true };
  if (team.status !== "Pending") return fail(409, "This entry isn't waiting for payment — register again");
  if (team.checkoutId) {
    const account = await paymentAccountForVenue(db, team.venueId);
    try {
      const invoice = await xendit.getInvoice(team.checkoutId, account);
      if (invoice.paid) {
        const settled = await settleInvoice(db, invoice.id, { invoice, account });
        return { ok: true, paid: settled.outcome === "CONFIRMED", outcome: settled.outcome };
      }
      if (invoice.status === "PENDING" && team.checkoutUrl) return { ok: true, checkoutUrl: team.checkoutUrl };
    } catch (err) {
      logger.warn("Xendit: could not read a tournament checkout", { tournamentTeamId, error: err.message });
    }
  }
  return openTeamCheckout(db, tournamentTeamId);
};

/** Should this paid invoice keep the entry? Otherwise the money goes back. */
const decide = async (conn, { team, division, tournament }, invoice, now) => {
  if (cents(invoice.amount) !== cents(team.price)) return { keep: false, reason: "OTHERS", why: "AMOUNT_MISMATCH" };
  if (team.paymentStatus !== "Unpaid") return { keep: false, reason: "DUPLICATE", why: "ALREADY_PAID" };
  if (!["Open", "Closed"].includes(tournament.status) || division.drawGeneratedAt) {
    return { keep: false, reason: "CANCELLATION", why: "REGISTRATION_OVER" };
  }
  if (team.status === "Pending" && team.holdExpiresAt && team.holdExpiresAt > now) return { keep: true };
  if (["Pending", "Expired"].includes(team.status)) {
    const [rows] = await conn.execute(
      `SELECT COUNT(*) AS n FROM tournament_teams t
       WHERE t.divisionId = ? AND t.tournamentTeamId != ? AND (t.status = 'Registered'
         OR (t.status = 'Pending' AND (t.paymentStatus IN ('Paid', 'Free') OR t.holdExpiresAt > ?)))`,
      [division.divisionId, team.tournamentTeamId, now]
    );
    if (Number(rows[0].n) < division.capacity) return { keep: true };
    return { keep: false, reason: "CANCELLATION", why: "DIVISION_FULL" };
  }
  return { keep: false, reason: "CANCELLATION", why: `TEAM_${String(team.status).toUpperCase()}` };
};

/** A paid `team-<code>` invoice → one payment row, then the entry Paid (Registered when full) or refunded. */
export const settleTeamInvoice = async (db, invoice, teamCode, companyId = null) => {
  const now = getCurrentTimestampLocal();
  let conn;
  let decision;
  let paymentId;
  let teamId;
  let registered = false;
  try {
    conn = await db.beginTransaction();
    const [peek] = await conn.execute(
      `SELECT d.tournamentId FROM tournament_teams tt JOIN tournament_divisions d ON d.divisionId = tt.divisionId
       WHERE tt.teamCode = ? LIMIT 1`,
      [teamCode]
    );
    if (!peek.length) {
      await db.rollback(conn);
      logger.warn("Xendit: a paid invoice for no tournament entry", { invoiceId: invoice.id, teamCode });
      return { outcome: "UNKNOWN_BOOKING" };
    }
    const [tournaments] = await conn.execute(
      `SELECT t.*, v.companyId FROM tournaments t JOIN venues v ON v.venueId = t.venueId
       WHERE t.tournamentId = ? LIMIT 1 FOR UPDATE`,
      [peek[0].tournamentId]
    );
    const tournament = tournaments[0];
    if (companyId && tournament.companyId !== companyId) {
      await db.rollback(conn);
      logger.warn("Xendit: a company's invoice names another company's tournament entry", { invoiceId: invoice.id });
      return { outcome: "WRONG_COMPANY" };
    }
    const [teams] = await conn.execute(`SELECT * FROM tournament_teams WHERE teamCode = ? LIMIT 1 FOR UPDATE`, [teamCode]);
    const team = teams[0];
    const [divisions] = await conn.execute(`SELECT * FROM tournament_divisions WHERE divisionId = ?`, [team.divisionId]);
    const [existing] = await conn.execute(`SELECT paymentId FROM payments WHERE providerRef = ? LIMIT 1`, [invoice.id]);
    if (existing.length) {
      await db.rollback(conn);
      return { outcome: "ALREADY_RECORDED" };
    }
    teamId = team.tournamentTeamId;
    decision = await decide(conn, { team, division: divisions[0], tournament }, invoice, now);
    const [uuid] = await conn.execute(`SELECT UUID() AS id`);
    paymentId = uuid[0].id;
    await conn.execute(
      `INSERT INTO payments
         (paymentId, tournamentTeamId, venueId, amount, method, provider, providerRef, refundError, note,
          status, paidAt, dateCreated, dateUpdated)
       VALUES (?, ?, ?, ?, 'ONLINE', 'xendit', ?, ?, ?, 'Paid', ?, ?, ?)`,
      [
        paymentId,
        teamId,
        tournament.venueId,
        invoice.amount,
        invoice.id,
        decision.keep ? null : REFUND_QUEUED,
        decision.keep
          ? `Tournament entry ${teamCode}`
          : `Tournament entry ${teamCode} — paid but not kept (${decision.why}), refunded`,
        now,
        now,
        now,
      ]
    );
    if (decision.keep) {
      await conn.execute(
        `UPDATE tournament_teams
         SET status = 'Pending', paymentStatus = 'Paid', holdExpiresAt = NULL, checkoutId = NULL, checkoutUrl = NULL,
             dateUpdated = ?
         WHERE tournamentTeamId = ?`,
        [now, teamId]
      );
      registered = await registerIfComplete(conn, { tournamentTeamId: teamId, teamSize: divisions[0].teamSize, now });
    } else {
      await conn.execute(
        `UPDATE tournament_teams SET status = IF(status = 'Pending', 'Expired', status),
           checkoutId = IF(checkoutId = ?, NULL, checkoutId), dateUpdated = ?
         WHERE tournamentTeamId = ?`,
        [invoice.id, now, teamId]
      );
    }
    await db.commit(conn);
  } catch (err) {
    await db.rollback(conn);
    if (err.code === "ER_DUP_ENTRY") return { outcome: "ALREADY_RECORDED" };
    throw err;
  }

  if (decision.keep) {
    await sendTournamentEmail(db, teamId, registered ? "Registered" : "PaidWaitingPartner");
    return { outcome: "CONFIRMED" };
  }
  logger.warn("Xendit: refunding a tournament entry that can't be kept", { paymentId, why: decision.why });
  const [sent] = await sendRefunds(db, { paymentIds: [paymentId], reason: decision.reason });
  await sendTournamentEmail(db, teamId, "PaymentRefunded", { refunded: Boolean(sent?.ok), amount: Number(invoice.amount) });
  return { outcome: sent?.ok ? "REFUNDED" : "REFUND_FAILED", why: decision.why };
};
