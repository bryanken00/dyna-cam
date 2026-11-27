import express from "express";
import { catchAsync, validateParams } from "../../../utils/catchAsync.js";
import { getCurrentTimestampLocal, moment } from "../../../utils/dateUtils.js";
import { hashToken } from "../../../utils/crypto/tokens.js";
import { minutesToTime } from "../../../utils/bookingPrice.js";
import { DAY_MINUTES, firstBookableDate, loadVenueHours } from "../../../utils/courtTimeline.js";
import { expireHolds } from "../../../utils/bookings.js";
import { advanceSessions } from "../../../utils/sessions.js";
import { signUploadUrl } from "../../../utils/file/signedUrl.js";
import { displayTokenParamsSchema } from "../../../validators/public.validator.js";
import { firstName } from "../../../utils/openPlay.js";
import { loadQueue } from "../../../utils/openPlayGames.js";

/**
 * CR-038 — a venue's TV court board, mounted at /api/v1/public/board with NO
 * login: the venue's display link (venues.displayToken, issued from the venue
 * page) is the credential. It answers only what a TV in the venue shows —
 * today's courts and when each is booked, in play or closed. Never a name, a
 * booking code, a closure's reason or a business ID: courts are named by a key
 * derived from the link, and a booking's status is reduced to Booked / In play
 * / Played.
 *
 *   GET /:displayToken      today at the venue (the TV polls it every minute)
 */
const router = express.Router();

const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";
const FORMAT = "YYYY-MM-DD HH:mm:ss";

const courtKey = (displayToken, courtId) => hashToken(`board:${displayToken}:${courtId}`).slice(0, 16);

/** A booking as the board says it: Booked (held, paid, no-show), In play, Played. */
const boardStatus = (status) =>
  status === "CheckedIn" ? "CheckedIn" : status === "Completed" ? "Completed" : "Confirmed";

router.get(
  "/:displayToken",
  validateParams(displayTokenParamsSchema),
  catchAsync(async (req, res) => {
    const { displayToken } = req.params;
    const venues = await req.db.query(
      `SELECT venueId, name, logoUrl FROM venues
       WHERE displayToken = ? AND status = 'Active' LIMIT 1`,
      [displayToken]
    );
    if (venues.length === 0) {
      return res.sendError("This court board link isn't valid", 404);
    }
    const venue = venues[0];
    await Promise.all([
      expireHolds(req.db, { venueId: venue.venueId }),
      advanceSessions(req.db, { venueId: venue.venueId }),
    ]);

    // CR-049: "today" is last night's date while its hours past midnight still run,
    // and the board runs to the day's closing (the next morning when it closes late)
    const hours = await loadVenueHours(req.db, venue.venueId);
    const date = firstBookableDate(hours);
    const open = hours.get(moment.tz(date, "YYYY-MM-DD", TIMEZONE).day());
    const dayStart = `${date} 00:00:00`;
    const dayEnd = moment
      .tz(dayStart, FORMAT, TIMEZONE)
      .add(Math.max(open?.closesAt || 0, DAY_MINUTES), "minutes")
      .format(FORMAT);
    const window = [dayEnd, dayStart];

    const [courts, bookings, games, closures] = await Promise.all([
      req.db.query(
        `SELECT courtId, name FROM courts
         WHERE venueId = ? AND status = 'Active'
         ORDER BY name ASC`,
        [venue.venueId]
      ),
      req.db.query(
        `SELECT courtId, status, startAt, endAt FROM bookings
         WHERE venueId = ? AND status NOT IN ('Cancelled', 'Expired', 'Deleted')
           AND startAt < ? AND endAt > ?
         ORDER BY startAt ASC`,
        [venue.venueId, ...window]
      ),
      // A booking's own game is drawn as the booking
      req.db.query(
        `SELECT courtId, status, startAt, endAt, openEnded FROM recording_sessions
         WHERE venueId = ? AND bookingId IS NULL AND status NOT IN ('Cancelled', 'Failed')
           AND startAt < ? AND endAt > ?
         ORDER BY startAt ASC`,
        [venue.venueId, ...window]
      ),
      req.db.query(
        `SELECT courtId, startAt, endAt FROM court_closures
         WHERE venueId = ? AND status = 'Active' AND startAt < ? AND endAt > ?
         ORDER BY startAt ASC`,
        [venue.venueId, ...window]
      ),
    ]);

    const key = (courtId) => courtKey(displayToken, courtId);

    // PLAN-009 phase D: Open Play running now — who's on which court, who's next, how many wait
    const nowLocal = getCurrentTimestampLocal();
    const liveSessions = await req.db.query(
      `SELECT playSessionId, title, startAt, endAt, queuePaused FROM play_sessions
       WHERE venueId = ? AND status = 'Scheduled' AND startAt <= ? AND endAt > ?
       ORDER BY startAt ASC`,
      [venue.venueId, nowLocal, nowLocal]
    );
    const openPlay = [];
    for (const session of liveSessions) {
      const state = await loadQueue(req.db, session.playSessionId);
      const names = (ids) => ids.map((id) => firstName(state.byId.get(id)?.name));
      openPlay.push({
        title: session.title,
        startAt: session.startAt,
        endAt: session.endAt,
        paused: Boolean(session.queuePaused),
        courts: state.courts.map((c) => {
          const game = state.playing.find((g) => g.courtId === c.courtId);
          return {
            courtKey: key(c.courtId),
            name: c.name,
            game: game ? { teamA: names(game.teamA), teamB: names(game.teamB), startedAt: game.startedAt } : null,
          };
        }),
        next: state.queued.slice(0, 3).map((g) => ({ teamA: names(g.teamA), teamB: names(g.teamB) })),
        waiting: state.waiting.length,
        waitingNames: names(state.waiting.slice(0, 12).map((p) => p.id)),
      });
    }

    // PLAN-009 phase E: a tournament on today — matches on court, up next, results (team names only)
    const todaysTournaments = await req.db.query(
      `SELECT tournamentId, name FROM tournaments
       WHERE venueId = ? AND status IN ('Open', 'Closed', 'Live') AND startDate <= ? AND endDate >= ?
       ORDER BY startDate ASC`,
      [venue.venueId, date, date]
    );
    const tournaments = [];
    for (const t of todaysTournaments) {
      const matches = await req.db.query(
        `SELECT m.status, m.scheduledAt, m.scoreA, m.scoreB, m.winnerTeamId, m.teamAId, m.teamBId, m.courtId,
                d.name AS divisionName, ta.name AS teamA, tb.name AS teamB
         FROM tournament_matches m
         JOIN tournament_divisions d ON d.divisionId = m.divisionId AND d.tournamentId = ? AND d.status = 'Active'
         LEFT JOIN tournament_teams ta ON ta.tournamentTeamId = m.teamAId
         LEFT JOIN tournament_teams tb ON tb.tournamentTeamId = m.teamBId
         WHERE m.status IN ('Playing', 'Ready', 'Done')
         ORDER BY m.dateUpdated DESC`,
        [t.tournamentId]
      );
      const view = (m) => ({
        courtKey: m.courtId ? key(m.courtId) : null,
        division: m.divisionName,
        teamA: m.teamA,
        teamB: m.teamB,
        scheduledAt: m.scheduledAt,
        scoreA: m.scoreA,
        scoreB: m.scoreB,
        winner: m.winnerTeamId ? (m.winnerTeamId === m.teamAId ? "A" : "B") : null,
      });
      tournaments.push({
        name: t.name,
        playing: matches.filter((m) => m.status === "Playing").map(view),
        next: matches
          .filter((m) => m.status === "Ready" && m.courtId && m.scheduledAt)
          .sort((a, b) => (a.scheduledAt < b.scheduledAt ? -1 : 1))
          .slice(0, 6)
          .map(view),
        results: matches.filter((m) => m.status === "Done").slice(0, 6).map(view),
      });
    }

    return res.sendSuccess("Court board", {
      openPlay,
      tournaments,
      venue: { name: venue.name, logoUrl: signUploadUrl(venue.logoUrl) },
      date,
      now: getCurrentTimestampLocal(),
      hours: open ? { opensAt: minutesToTime(open.opensAt), closesAt: minutesToTime(open.closesAt) } : null,
      courts: courts.map((c) => ({ key: key(c.courtId), name: c.name })),
      bookings: bookings.map((b) => ({
        courtKey: key(b.courtId),
        status: boardStatus(b.status),
        startAt: b.startAt,
        endAt: b.endAt,
      })),
      games: games.map((g) => ({
        courtKey: key(g.courtId),
        status: g.status,
        startAt: g.startAt,
        endAt: g.endAt,
        openEnded: Number(g.openEnded) === 1,
      })),
      // A venue-wide closure has no court
      closures: closures.map((c) => ({
        courtKey: c.courtId ? key(c.courtId) : null,
        startAt: c.startAt,
        endAt: c.endAt,
      })),
    });
  })
);

export default router;
