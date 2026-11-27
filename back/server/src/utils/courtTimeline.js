import { getCurrentTimestampLocal, moment } from "./dateUtils.js";
import { selectRows } from "./dbRows.js";
import { minutesToTime, timeToMinutes } from "./bookingPrice.js";

/**
 * PLAN-003: one court, one timeline. Games, live bookings and closures can't
 * overlap, and bookings stay inside the venue's opening hours. Every writer
 * that puts something on a court's timeline (a booking, a move, a check-in, a
 * game) locks the court row FOR UPDATE first and then asks findConflict(), so
 * two of them can't both pass the check.
 */

const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";
const FORMAT = "YYYY-MM-DD HH:mm:ss";

/**
 * A booking that holds its slot (alias `b`, one `?` = now): Confirmed or
 * CheckedIn, or Pending with its hold not yet run out.
 */
export const LIVE_BOOKING = `(b.status IN ('Confirmed', 'CheckedIn')
  OR (b.status = 'Pending' AND b.holdExpiresAt > ?))`;

/** A game that occupies its window (alias `s`). */
const LIVE_GAME = `s.status NOT IN ('Cancelled', 'Failed')`;

/** Minutes in a day: a closesAt past this runs into the next morning (CR-049). */
export const DAY_MINUTES = 24 * 60;

/**
 * A venue's opening hours: Map dayOfWeek → { opensAt, closesAt } in minutes from
 * that day's midnight. CR-049: closesAt may pass 1440 (1500 = 1 AM the next day),
 * up to 24 hours after opensAt — those late hours belong to the evening's day.
 */
export const loadVenueHours = async (db, venueId) => {
  const rows = await selectRows(
    db,
    `SELECT dayOfWeek, opensAt, closesAt FROM venue_hours
     WHERE venueId = ? AND status = 'Active'`,
    [venueId]
  );
  return new Map(
    rows.map((r) => [
      Number(r.dayOfWeek),
      { opensAt: timeToMinutes(r.opensAt), closesAt: timeToMinutes(r.closesAt) },
    ])
  );
};

/** Hours as the API returns them, one entry per open day, Sunday first. */
export const hoursList = (hours) =>
  [...hours.entries()]
    .sort(([a], [b]) => a - b)
    .map(([dayOfWeek, h]) => ({
      dayOfWeek,
      opensAt: minutesToTime(h.opensAt),
      closesAt: minutesToTime(h.closesAt),
    }));

/**
 * Whether [startLocal, endLocal) lies inside one day's opening hours: its own
 * day's, or (CR-049) the late hours of the day before that run past midnight.
 */
export const withinHours = (hours, startLocal, endLocal) => {
  const start = moment.tz(startLocal, FORMAT, TIMEZONE);
  const end = moment.tz(endLocal, FORMAT, TIMEZONE);
  const startMinutes = start.hours() * 60 + start.minutes();
  const minutesLong = end.diff(start, "minutes");
  const inside = (day, from) => Boolean(day) && day.opensAt <= from && from + minutesLong <= day.closesAt;
  return (
    inside(hours.get(start.day()), startMinutes) ||
    inside(hours.get((start.day() + 6) % 7), startMinutes + DAY_MINUTES)
  );
};

/**
 * CR-049: the first date a player can pick — today, or yesterday while its late
 * hours (past midnight) are still running, so 12:30 AM still shows last night.
 */
export const firstBookableDate = (hours, nowLocal = getCurrentTimestampLocal()) => {
  const now = moment.tz(nowLocal, FORMAT, TIMEZONE);
  const yesterday = now.clone().subtract(1, "day");
  const late = hours.get(yesterday.day());
  const minuteOfDay = now.hours() * 60 + now.minutes();
  if (late && late.closesAt > DAY_MINUTES && minuteOfDay < late.closesAt - DAY_MINUTES) {
    return yesterday.format("YYYY-MM-DD");
  }
  return now.format("YYYY-MM-DD");
};

/**
 * The first thing in the way of [startLocal, endLocal) on a court, or null.
 *
 * @param db - req.db or a transaction connection (see dbRows.js); inside a
 *   writer's transaction, after it has locked the court row
 * @param {Object} window
 * @param {string} window.courtId
 * @param {string} window.startLocal - "YYYY-MM-DD HH:mm:ss" (Manila)
 * @param {string} window.endLocal
 * @param {string} [window.ignoreBookingId] - a booking being moved or checked in
 * @param {string} [window.ignorePlaySessionId] - PLAN-009: an Open Play session being moved
 *   (its own court blocks — closures tied to it — don't count)
 * @param {string} [window.ignoreTournamentId] - PLAN-009 phase E: a tournament re-holding its courts
 * @param {boolean} [window.checkHours] - also refuse outside opening hours (bookings)
 * @param {string} [window.now] - getCurrentTimestampLocal() (tests pass a fixed one)
 * @returns {Promise<null | { type: "GAME"|"BOOKING"|"CLOSURE"|"OPEN_PLAY"|"TOURNAMENT"|"CLOSED", from: string|null,
 *   until: string|null, id: string|null, code?: string }>} the earliest-starting conflict
 *   (code: a booking's bookingCode)
 *   (CLOSED — outside opening hours — has no window or id)
 */
export const findConflict = async (
  db,
  {
    courtId,
    startLocal,
    endLocal,
    ignoreBookingId = null,
    ignorePlaySessionId = null,
    ignoreTournamentId = null,
    checkHours = false,
    now,
  }
) => {
  const at = now || getCurrentTimestampLocal();
  const [court] = await selectRows(db, `SELECT venueId FROM courts WHERE courtId = ?`, [courtId]);
  if (!court) return null;

  const [games, bookings, closures] = await Promise.all([
    selectRows(
      db,
      `SELECT s.sessionId AS id, s.startAt AS \`from\`, s.endAt AS \`until\`
       FROM recording_sessions s
       WHERE s.courtId = ? AND ${LIVE_GAME} AND s.startAt < ? AND s.endAt > ?
       ORDER BY s.startAt ASC`,
      [courtId, endLocal, startLocal]
    ),
    selectRows(
      db,
      `SELECT b.bookingId AS id, b.bookingCode AS code, b.startAt AS \`from\`,
              b.endAt AS \`until\`
       FROM bookings b
       WHERE b.courtId = ? AND ${LIVE_BOOKING} AND b.startAt < ? AND b.endAt > ?
         AND (? IS NULL OR b.bookingId != ?)
       ORDER BY b.startAt ASC`,
      [courtId, at, endLocal, startLocal, ignoreBookingId, ignoreBookingId]
    ),
    selectRows(
      db,
      `SELECT c.closureId AS id, c.startAt AS \`from\`, c.endAt AS \`until\`, c.playSessionId, c.tournamentId
       FROM court_closures c
       WHERE c.venueId = ? AND (c.courtId IS NULL OR c.courtId = ?) AND c.status = 'Active'
         AND c.startAt < ? AND c.endAt > ?
         AND (? IS NULL OR c.playSessionId IS NULL OR c.playSessionId != ?)
         AND (? IS NULL OR c.tournamentId IS NULL OR c.tournamentId != ?)
       ORDER BY c.startAt ASC`,
      [
        court.venueId,
        courtId,
        endLocal,
        startLocal,
        ignorePlaySessionId,
        ignorePlaySessionId,
        ignoreTournamentId,
        ignoreTournamentId,
      ]
    ),
  ]);

  const found = [
    ...games.map((g) => ({ type: "GAME", ...g })),
    ...bookings.map((b) => ({ type: "BOOKING", ...b })),
    // PLAN-009: an Open Play session's court block is a closure tied to the session
    // …and a tournament's hold on its courts (phase E) too
    ...closures.map(({ playSessionId, tournamentId, ...c }) => ({
      type: playSessionId ? "OPEN_PLAY" : tournamentId ? "TOURNAMENT" : "CLOSURE",
      ...c,
    })),
  ].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  if (found.length > 0) return found[0];

  if (checkHours) {
    const hours = await loadVenueHours(db, court.venueId);
    if (!withinHours(hours, startLocal, endLocal)) {
      return { type: "CLOSED", from: null, until: null, id: null };
    }
  }
  return null;
};
