import { getCurrentTimestampLocal, moment } from "./dateUtils.js";

/**
 * CR-043: a venue's weekly hours and prices open for online booking one week at a
 * time. A week runs Monday to Sunday in the venue's time; staff confirm next week
 * (Setup → Booking rules, or the Dashboard) and `venues.scheduleConfirmedUntil`
 * becomes its Sunday. Players can book only up to that date (and no further than
 * bookingDaysAhead); staff at the desk are not limited by it.
 */

const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";
const DATE = "YYYY-MM-DD";
const STAMP = "YYYY-MM-DD HH:mm:ss";

/** Fewer hours than this before next week starts → the Dashboard notice turns to a warning. */
export const SCHEDULE_WARNING_HOURS = 72;

const day = (date) => moment.tz(date, DATE, TIMEZONE);

/** The Monday of `date`'s week. */
const mondayOf = (date) => day(date).isoWeekday(1).format(DATE);

/** The Sunday that ends `date`'s week. */
export const sundayOf = (date) => day(date).isoWeekday(7).format(DATE);

/** Next week (Monday to Sunday) as seen from `today`. */
export const nextWeekOf = (today) => {
  const start = day(mondayOf(today)).add(7, "days");
  return { start: start.format(DATE), end: start.clone().add(6, "days").format(DATE) };
};

/** What a Confirm on `today` confirms through: the end of next week. */
export const confirmTarget = (today) => nextWeekOf(today).end;

/**
 * The last date a player may book or move to: today + bookingDaysAhead, capped by
 * the confirmed week. Before `today` when nothing is open (never confirmed, or this
 * week not confirmed).
 */
export const playerLastDate = (venue, today) => {
  const byDaysAhead = day(today).add(venue.bookingDaysAhead, "days").format(DATE);
  const confirmed = venue.scheduleConfirmedUntil
    ? String(venue.scheduleConfirmedUntil).slice(0, 10)
    : day(today).subtract(1, "day").format(DATE);
  return confirmed < byDaysAhead ? confirmed : byDaysAhead;
};

/** Is `date` past the venue's confirmed schedule (players can't book it yet)? */
export const isPastConfirmed = (venue, date) =>
  !venue.scheduleConfirmedUntil || date > String(venue.scheduleConfirmedUntil).slice(0, 10);

/** Players' message for a date in a week staff haven't confirmed yet. */
export const NOT_OPEN_MESSAGE = "Bookings for that week aren't open yet — check back soon";

/**
 * Where a venue stands, for Setup and the Dashboard notice.
 * level: "ok" (next week confirmed) · "due" (next week not confirmed yet) ·
 * "soon" (fewer than SCHEDULE_WARNING_HOURS before next week starts) ·
 * "closed" (this week isn't confirmed: online booking has no open date now).
 */
export const scheduleStatus = (confirmedUntil, now = getCurrentTimestampLocal()) => {
  const today = now.slice(0, 10);
  const nextWeek = nextWeekOf(today);
  const through = confirmedUntil ? String(confirmedUntil).slice(0, 10) : null;
  const hoursLeft = Math.max(
    0,
    moment.tz(`${nextWeek.start} 00:00:00`, STAMP, TIMEZONE).diff(moment.tz(now, STAMP, TIMEZONE), "hours", true)
  );

  let level = "ok";
  if (!through || through < sundayOf(today)) level = "closed";
  else if (through < nextWeek.end) level = hoursLeft < SCHEDULE_WARNING_HOURS ? "soon" : "due";

  return {
    confirmedUntil: through,
    nextWeekStart: nextWeek.start,
    nextWeekEnd: nextWeek.end,
    nextWeekConfirmed: level === "ok",
    daysLeft: Math.ceil(hoursLeft / 24),
    level,
  };
};
