import { getCurrentTimestampLocal, moment } from "./dateUtils.js";
import { selectRows } from "./dbRows.js";
import { BOOKING_SLOT_MINUTES, loadRates, minutesToTime, quoteFromRates } from "./bookingPrice.js";
import { DAY_MINUTES, LIVE_BOOKING, loadVenueHours } from "./courtTimeline.js";
import { runningHourBookable } from "./bookings.js";

/**
 * PLAN-003 Phase C: which hours of a day a player can book, per court, for
 * one length — the public booking page's grid. The same rules as
 * findConflict() (games, live bookings, closures, opening hours) and the price
 * from quoteFromRates(), worked out for the whole day in one pass instead of
 * one query per slot. The write (createBooking) checks again under the court
 * lock, so a slot shown free can still be refused if someone takes it first.
 */

const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";
const FORMAT = "YYYY-MM-DD HH:mm:ss";

const overlaps = (item, startLocal, endLocal) => item.startAt < endLocal && item.endAt > startLocal;

/**
 * @param db - req.db
 * @param {Object} q
 * @param {string} q.venueId
 * @param {Array<{ courtId: string, name: string }>} q.courts - the venue's Active courts
 * @param {string} q.date - "YYYY-MM-DD"
 * @param {number} q.durationMinutes - whole hours
 * @param {boolean} [q.allowRunning] - CR-047: show the hour that's already running
 *   while it's bookable (its first half) — the public booking page
 * @param {Object} [q.moving] - Phase H: a player moving their booking — its own
 *   time doesn't count as taken, only slots priced at most `maxPrice` are offered,
 *   and its current slot is marked `current`
 * @param {string} q.moving.bookingId
 * @param {string} q.moving.courtId
 * @param {string} q.moving.startAt
 * @param {number} q.moving.maxPrice
 * @returns {Promise<{ hours: { opensAt, closesAt } | null,
 *   courts: Array<{ courtId, name, slots: Array<{ startTime, available, price, current?, nextDay? }> }> }>}
 *   price is null when the slot isn't available, and `reason` says why: "past", "taken"
 *   (a booking or game), "closed" (a closure), "noPrice" (no rate covers it) or "pricier"
 *   (moving: costs more than the booking). CR-049: hours past midnight (the
 *   day's late opening) are "24:00", "25:00", … with `nextDay: true`; the date's own
 *   early hours that belong to the day before aren't listed.
 */
export const dayAvailability = async (
  db,
  { venueId, courts, date, durationMinutes, moving = null, allowRunning = false }
) => {
  const now = getCurrentTimestampLocal();
  const dayStart = moment.tz(`${date} 00:00:00`, FORMAT, TIMEZONE);
  const hours = await loadVenueHours(db, venueId);
  const day = hours.get(dayStart.day());
  if (!day || courts.length === 0) {
    return {
      hours: day ? { opensAt: minutesToTime(day.opensAt), closesAt: minutesToTime(day.closesAt) } : null,
      courts: courts.map((c) => ({ courtId: c.courtId, name: c.name, slots: [] })),
    };
  }

  const from = dayStart.format(FORMAT);
  // A slot runs at most to the day's closing — the next morning when it closes late (CR-049)
  const to = dayStart.clone().add(Math.max(day.closesAt, DAY_MINUTES), "minutes").format(FORMAT);

  const [rates, bookings, games, closures] = await Promise.all([
    loadRates(db, venueId),
    selectRows(
      db,
      `SELECT b.bookingId, b.courtId, b.startAt, b.endAt FROM bookings b
       WHERE b.venueId = ? AND ${LIVE_BOOKING} AND b.startAt < ? AND b.endAt > ?`,
      [venueId, now, to, from]
    ),
    selectRows(
      db,
      `SELECT s.courtId, s.startAt, s.endAt FROM recording_sessions s
       WHERE s.venueId = ? AND s.status NOT IN ('Cancelled', 'Failed')
         AND s.startAt < ? AND s.endAt > ?`,
      [venueId, to, from]
    ),
    selectRows(
      db,
      `SELECT c.courtId, c.startAt, c.endAt FROM court_closures c
       WHERE c.venueId = ? AND c.status = 'Active' AND c.startAt < ? AND c.endAt > ?`,
      [venueId, to, from]
    ),
  ]);

  const firstHour = Math.ceil(day.opensAt / 60);
  const lastStartMinute = day.closesAt - durationMinutes;

  return {
    hours: { opensAt: minutesToTime(day.opensAt), closesAt: minutesToTime(day.closesAt) },
    courts: courts.map((court) => {
      const inTheWay = [
        ...bookings.filter((b) => b.courtId === court.courtId && b.bookingId !== moving?.bookingId),
        ...games.filter((g) => g.courtId === court.courtId),
        ...closures.filter((c) => !c.courtId || c.courtId === court.courtId).map((c) => ({ ...c, closure: true })),
      ];
      const slots = [];
      for (let minute = firstHour * 60; minute <= lastStartMinute; minute += BOOKING_SLOT_MINUTES) {
        const start = dayStart.clone().add(minute, "minutes");
        const startLocal = start.format(FORMAT);
        const endLocal = start.clone().add(durationMinutes, "minutes").format(FORMAT);
        const running = allowRunning && runningHourBookable(startLocal, now);
        const notPast = startLocal > now || running;
        const blocker = notPast ? inTheWay.find((item) => overlaps(item, startLocal, endLocal)) : null;
        const free = notPast && !blocker;
        const price = free
          ? quoteFromRates(rates, { courtId: court.courtId, startLocal, durationMinutes })
          : null;
        const current = Boolean(moving) && court.courtId === moving.courtId && startLocal === moving.startAt;
        const available =
          Boolean(price?.bookable) && (!moving || (!current && price.price <= moving.maxPrice));
        // Why it can't be booked — so the page doesn't call an unpriced or past hour "Taken"
        let reason = null;
        if (!available && !current) {
          if (!notPast) reason = "past";
          else if (blocker) reason = blocker.closure ? "closed" : "taken";
          else if (!price?.bookable) reason = "noPrice";
          else reason = "pricier";
        }
        slots.push({
          startTime: minutesToTime(minute),
          ...(minute >= DAY_MINUTES ? { nextDay: true } : {}),
          available,
          price: available ? price.price : null,
          ...(current ? { current: true } : {}),
          ...(reason ? { reason } : {}),
          // CR-047: the hour that's running now (bookable in its first half)
          ...(running ? { now: true } : {}),
        });
      }
      return { courtId: court.courtId, name: court.name, slots };
    }),
  };
};
