import { logger } from "../../config/logger.js";
import { sendMail } from "../lib/mailer/mailer.js";
import { tournamentEmail } from "../lib/mailer/templates.js";
import { teamInviteUrl, tournamentUrl } from "./clips.js";
import { firstName } from "./openPlay.js";

/**
 * PLAN-009 phase E — tournament emails, sent after the commit of the request
 * that causes them and never failing it. They go to every player on the team
 * who has an email (a team staff typed in has none).
 *
 *   Registered          the team is paid (or free) and full — it's in the draw
 *   PaidWaitingPartner  the captain paid; the partner still has to join (the invite link)
 *   PaymentRefunded     a payment the entry couldn't keep
 *   Withdrawn           the team was taken out (refund line when it was paid)
 *   DrawOut             the division's draw is out
 *   MatchCalled         { court, opponent } — go to the court
 */

const peso = (amount) => `₱${Number(amount).toLocaleString("en-PH")}`;

const loadTeam = async (db, tournamentTeamId) => {
  const [team] = await db.query(
    `SELECT tt.tournamentTeamId, tt.name, tt.price, tt.paymentStatus, tt.inviteToken, d.name AS divisionName,
            t.name AS tournamentName, t.publicToken, t.startDate, v.name AS venueName
     FROM tournament_teams tt
     JOIN tournament_divisions d ON d.divisionId = tt.divisionId
     JOIN tournaments t ON t.tournamentId = d.tournamentId
     JOIN venues v ON v.venueId = t.venueId
     WHERE tt.tournamentTeamId = ? LIMIT 1`,
    [tournamentTeamId]
  );
  if (!team) return null;
  const players = await db.query(
    `SELECT p.name, p.email FROM tournament_team_players tp JOIN players p ON p.playerId = tp.playerId
     WHERE tp.tournamentTeamId = ? AND p.email IS NOT NULL`,
    [tournamentTeamId]
  );
  return { ...team, players };
};

const BUILD = {
  Registered: (t) => ({
    subject: `You're in: ${t.tournamentName} — ${t.divisionName}`,
    heading: "Your team is registered",
    lines: [`Team ${t.name} is in ${t.divisionName} at ${t.tournamentName} (${t.venueName}).`, "We'll email you when the draw is out."],
  }),
  PaidWaitingPartner: (t) => ({
    subject: `Paid — send your partner the invite: ${t.tournamentName}`,
    heading: "One more step: your partner",
    lines: [
      `Your entry for team ${t.name} is paid. Your partner joins with the invite link below — send it to them.`,
      "The team is registered once they join.",
    ],
    buttonUrl: t.inviteToken ? teamInviteUrl(t.inviteToken) : null,
    buttonLabel: "The invite link",
  }),
  PaymentRefunded: (t, extra) => ({
    subject: `Your payment to ${t.venueName} is being refunded`,
    heading: "We're refunding your entry fee",
    lines: [
      `Registration for ${t.divisionName} was already over (or full) when your payment came in.`,
      extra.refunded
        ? `${peso(extra.amount)} is being refunded to the account you paid with. It can take a few days to show.`
        : `We couldn't refund ${peso(extra.amount)} automatically — the venue will contact you.`,
    ],
  }),
  Withdrawn: (t) => ({
    subject: `Withdrawn: ${t.tournamentName} — ${t.divisionName}`,
    heading: "Your team was withdrawn",
    lines: [
      `Team ${t.name} is no longer in ${t.divisionName}.`,
      ...(t.paymentStatus === "Paid" || t.paymentStatus === "Refunded"
        ? [`Your ${peso(t.price)} entry fee is being refunded to the account you paid with.`]
        : []),
    ],
  }),
  DrawOut: (t) => ({
    subject: `The draw is out: ${t.tournamentName} — ${t.divisionName}`,
    heading: "The draw is out",
    lines: [`See who team ${t.name} plays, and when, on the tournament's page.`],
  }),
  MatchCalled: (t, extra) => ({
    subject: `Your match is next — ${extra.court}`,
    heading: "Your match is next",
    lines: [`Team ${t.name}: head to ${extra.court}${extra.opponent ? ` — you play ${extra.opponent}` : ""}.`],
  }),
};

/** Email a team's players. Never throws. → how many were sent. */
export const sendTournamentEmail = async (db, tournamentTeamId, kind, extra = {}) => {
  try {
    const team = await loadTeam(db, tournamentTeamId);
    if (!team || !BUILD[kind]) return 0;
    const parts = BUILD[kind](team, extra);
    let sent = 0;
    for (const player of team.players) {
      const mail = tournamentEmail({
        ...parts,
        playerName: firstName(player.name),
        buttonUrl: parts.buttonUrl === undefined ? tournamentUrl(team.publicToken) : parts.buttonUrl,
        buttonLabel: parts.buttonLabel || "Open the tournament",
      });
      const done = await sendMail({ to: player.email, subject: mail.subject, html: mail.html });
      if (done.sent) sent += 1;
    }
    return sent;
  } catch (err) {
    logger.error("Tournament email failed", { tournamentTeamId, kind, error: err.message });
    return 0;
  }
};
