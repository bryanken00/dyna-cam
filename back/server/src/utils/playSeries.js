import { logger } from "../../config/logger.js";
import { getCurrentTimestampLocal, moment } from "./dateUtils.js";
import { createPlaySession } from "./openPlay.js";

/**
 * PLAN-009 phase C — weekly Open Play series. Staff set one up ("Tue & Thu
 * 6–9 PM, Courts 1–3"); its sessions are made ahead, SERIES_WEEKS_AHEAD weeks
 * out, by runPlaySeries() — right after the series is saved, then once an hour
 * from the minute job. A session is made once per series and start (a unique
 * key), so re-running never doubles one, and a session staff cancelled isn't
 * made again. A date whose courts aren't free (a booking, a closure, outside
 * opening hours) is skipped and logged; staff can add that one by hand.
 *
 * Stopping a series makes no new sessions; the ones already made stay (cancel
 * them one by one). Changing a session changes only that session.
 */

const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";
const FORMAT = "YYYY-MM-DD HH:mm:ss";
export const SERIES_WEEKS_AHEAD = 4;
const RUN_EVERY_MS = 60 * 60 * 1000;

let lastRunAt = 0;

/** "1,3" → [1, 3] (0 = Sunday). */
export const seriesDays = (value) =>
  String(value || "")
    .split(",")
    .filter((d) => d !== "")
    .map(Number);

/** "HH:mm:ss" from a TIME column (or "HH:mm"). */
const hms = (time) => (String(time).length === 5 ? `${time}:00` : String(time).slice(0, 8));

/**
 * The starts and ends a series wants from today to SERIES_WEEKS_AHEAD weeks out,
 * still ahead of `now` (a session already over isn't made).
 * @returns {Array<{ startAt, endAt }>}
 */
export const seriesWindows = (series, now) => {
  const today = moment.tz(now, FORMAT, TIMEZONE).startOf("day");
  const first = moment.max(today, moment.tz(series.startsOn, "YYYY-MM-DD", TIMEZONE));
  const last = today.clone().add(SERIES_WEEKS_AHEAD * 7 - 1, "days");
  const until = series.endsOn ? moment.min(last, moment.tz(series.endsOn, "YYYY-MM-DD", TIMEZONE)) : last;
  const days = new Set(seriesDays(series.daysOfWeek));
  const windows = [];
  for (const day = first.clone(); !day.isAfter(until, "day"); day.add(1, "day")) {
    if (!days.has(day.day())) continue;
    const date = day.format("YYYY-MM-DD");
    // An end at midnight (TIME 24:00:00) is the next day's 00:00
    const endAt = hms(series.endTime).startsWith("24:")
      ? `${day.clone().add(1, "day").format("YYYY-MM-DD")} 00:00:00`
      : `${date} ${hms(series.endTime)}`;
    if (endAt <= now) continue;
    windows.push({ startAt: `${date} ${hms(series.startTime)}`, endAt });
  }
  return windows;
};

/** Make one series' missing sessions. → how many were made. */
const fillSeries = async (db, series, now) => {
  const courts = await db.query(
    `SELECT sc.courtId FROM play_series_courts sc
     JOIN courts c ON c.courtId = sc.courtId AND c.status = 'Active'
     WHERE sc.seriesId = ?`,
    [series.seriesId]
  );
  if (!courts.length) return 0;
  const made = await db.query(`SELECT startAt FROM play_sessions WHERE seriesId = ?`, [series.seriesId]);
  const have = new Set(made.map((r) => r.startAt));
  let count = 0;
  for (const window of seriesWindows(series, now)) {
    if (have.has(window.startAt)) continue;
    let conn;
    try {
      conn = await db.beginTransaction();
      const created = await createPlaySession(conn, {
        venueId: series.venueId,
        seriesId: series.seriesId,
        fields: { ...series, ...window },
        courtIds: courts.map((c) => c.courtId),
        accountId: series.createdByAccountId,
        now,
      });
      if (!created.ok) {
        await db.rollback(conn);
        logger.info("Open Play series: a date was skipped", {
          seriesId: series.seriesId,
          startAt: window.startAt,
          why: created.message,
        });
        continue;
      }
      await db.commit(conn);
      count += 1;
    } catch (err) {
      await db.rollback(conn);
      if (err.code !== "ER_DUP_ENTRY") throw err; // another process made it meanwhile
    }
  }
  return count;
};

/**
 * Make the sessions every Active series still needs (or one series, at once).
 * Without `seriesId` it does the work at most once an hour (the minute job calls it).
 * @returns {Promise<{ made: number }>}
 */
export const runPlaySeries = async (db, { now = getCurrentTimestampLocal(), seriesId = null, force = false } = {}) => {
  if (!seriesId && !force) {
    if (Date.now() - lastRunAt < RUN_EVERY_MS) return { made: 0 };
    lastRunAt = Date.now();
  }
  const rows = await db.query(
    `SELECT ps.* FROM play_series ps
     JOIN venues v ON v.venueId = ps.venueId AND v.status = 'Active'
     JOIN companies co ON co.companyId = v.companyId AND co.status = 'Active'
     WHERE ps.status = 'Active' AND (ps.endsOn IS NULL OR ps.endsOn >= ?)
       AND (? IS NULL OR ps.seriesId = ?)`,
    [now.slice(0, 10), seriesId, seriesId]
  );
  let made = 0;
  for (const series of rows) {
    try {
      made += await fillSeries(db, series, now);
    } catch (err) {
      logger.error("Open Play series failed", { seriesId: series.seriesId, error: err.message });
    }
  }
  return { made };
};
