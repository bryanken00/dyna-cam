import { moment } from "./dateUtils.js";
import { selectRows } from "./dbRows.js";

/**
 * PLAN-003: court prices. A venue's `court_rates` give a price per hour for some
 * days and hours; a court's own rate beats a venue-wide one (courtId NULL). A
 * booking's price is the sum of each booked hour's rate, snapshotted on the
 * booking. Bookings start on the hour and last whole hours, at every venue.
 */

const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";
const FORMAT = "YYYY-MM-DD HH:mm:ss";

/** The booking grid: whole hours, for every venue (decided 2026-11-23). */
export const BOOKING_SLOT_MINUTES = 60;

/** "17:00:00" / "17:00" → 1020; "24:00:00" → 1440; "25:00:00" (1 AM the next day, CR-049) → 1500. */
export const timeToMinutes = (value) => {
  const [h, m] = String(value).split(":").map(Number);
  return h * 60 + (m || 0);
};

/** 1020 → "17:00"; 1440 → "24:00". */
export const minutesToTime = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** "1,2,3" → [1, 2, 3] (0 = Sunday … 6 = Saturday). */
export const parseDays = (value) =>
  String(value || "")
    .split(",")
    .filter((d) => d !== "")
    .map(Number);

/** A rate row as the API returns it. */
export const toRate = (row) => ({
  rateId: row.rateId,
  name: row.name,
  courtId: row.courtId || null,
  courtName: row.courtName || null,
  daysOfWeek: parseDays(row.daysOfWeek),
  startTime: minutesToTime(timeToMinutes(row.startTime)),
  endTime: minutesToTime(timeToMinutes(row.endTime)),
  pricePerHour: Number(row.pricePerHour),
});

/** A venue's live rates, normalised (minutes, day arrays). */
export const loadRates = async (db, venueId) => {
  const rows = await selectRows(
    db,
    `SELECT r.rateId, r.name, r.courtId, r.daysOfWeek, r.startTime, r.endTime, r.pricePerHour
     FROM court_rates r
     WHERE r.venueId = ? AND r.status = 'Active'`,
    [venueId]
  );
  return rows.map((row) => ({
    ...toRate(row),
    startMinutes: timeToMinutes(row.startTime),
    endMinutes: timeToMinutes(row.endTime),
  }));
};

const covers = (rate, dayOfWeek, minuteOfDay) =>
  rate.daysOfWeek.includes(dayOfWeek) &&
  rate.startMinutes <= minuteOfDay &&
  minuteOfDay < rate.endMinutes;

/**
 * The rate for one hour on one court: the court's own rate if one covers it,
 * otherwise a venue-wide one; null when none does.
 */
export const rateForHour = (rates, courtId, dayOfWeek, minuteOfDay) =>
  rates.find((r) => r.courtId === courtId && covers(r, dayOfWeek, minuteOfDay)) ||
  rates.find((r) => r.courtId === null && covers(r, dayOfWeek, minuteOfDay)) ||
  null;

/**
 * Price a booking from already-loaded rates (no database).
 *
 * @param {Array} rates - from loadRates()
 * @param {Object} booking
 * @param {string} booking.courtId
 * @param {string} booking.startLocal - "YYYY-MM-DD HH:mm:ss" (Manila)
 * @param {number} booking.durationMinutes
 * @returns {{ bookable: true, price: number, hours: Array<{ startAt: string, rateName: string, price: number }> }
 *   | { bookable: false, reason: "NOT_ON_THE_HOUR"|"BAD_LENGTH"|"NO_RATE", at?: string }}
 */
export const quoteFromRates = (rates, { courtId, startLocal, durationMinutes }) => {
  const start = moment.tz(startLocal, FORMAT, TIMEZONE);
  if (!start.isValid() || start.minutes() !== 0 || start.seconds() !== 0) {
    return { bookable: false, reason: "NOT_ON_THE_HOUR" };
  }
  if (
    !Number.isInteger(durationMinutes) ||
    durationMinutes < BOOKING_SLOT_MINUTES ||
    durationMinutes % BOOKING_SLOT_MINUTES !== 0
  ) {
    return { bookable: false, reason: "BAD_LENGTH" };
  }

  const hours = [];
  let price = 0;
  for (let offset = 0; offset < durationMinutes; offset += BOOKING_SLOT_MINUTES) {
    const hour = start.clone().add(offset, "minutes");
    const rate = rateForHour(rates, courtId, hour.day(), hour.hours() * 60 + hour.minutes());
    if (!rate) return { bookable: false, reason: "NO_RATE", at: hour.format(FORMAT) };
    // Pesos with centavos: add in centavos so 3 × 0.10 doesn't drift
    const hourPrice = Math.round(rate.pricePerHour * (BOOKING_SLOT_MINUTES / 60) * 100);
    price += hourPrice;
    hours.push({ startAt: hour.format(FORMAT), rateName: rate.name, price: hourPrice / 100 });
  }
  return { bookable: true, price: price / 100, hours };
};

/** Price a booking: loads the venue's rates, then quoteFromRates(). */
export const quote = async (db, { venueId, courtId, startLocal, durationMinutes }) =>
  quoteFromRates(await loadRates(db, venueId), { courtId, startLocal, durationMinutes });
