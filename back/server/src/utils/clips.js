import { moment } from "./dateUtils.js";

// Same zone dateUtils stores in (it does not export the constant).
const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";

/**
 * Dyna Cam clip rules shared by the admin, device and public routes
 * (PLAN-001). Timestamps are Asia/Manila "YYYY-MM-DD HH:mm:ss" strings like
 * every other stored time — see utils/dateUtils.js.
 */

/** Seconds of video before the moment a save was requested. */
export const CLIP_PRE_SECONDS = 60;
/** Seconds after it — covers the time it takes to reach the QR or button. */
export const CLIP_POST_SECONDS = 5;

/** A recorder box counts as online if its last heartbeat is this recent. */
export const DEVICE_ONLINE_SECONDS = 90;

/** A clip still Pending/Processing after this long is marked Failed. */
export const CLIP_STALE_MINUTES = 15;

/**
 * Session parts get longer: the box keeps their footage until 30 minutes after
 * the session ends, and with several courts in sessions their parts queue up
 * behind players' clips (which are cut first — their footage only lasts the
 * rolling buffer).
 */
export const SESSION_PART_STALE_MINUTES = 60;

const FORMAT = "YYYY-MM-DD HH:mm:ss";

/** Manila timestamp `seconds` ago. */
export const secondsAgoLocal = (seconds) =>
  moment().tz(TIMEZONE).subtract(seconds, "seconds").format(FORMAT);

/** Manila timestamp `days` from now. */
export const daysFromNowLocal = (days) => moment().tz(TIMEZONE).add(days, "days").format(FORMAT);

/**
 * A stored Manila timestamp as epoch milliseconds — what the recorder box
 * matches against its own (NTP-synced) clock.
 */
export const toEpochMs = (localTimestamp) =>
  localTimestamp ? moment.tz(localTimestamp, FORMAT, TIMEZONE).valueOf() : null;

/** Whether a stored lastSeenAt counts as online. */
export const isOnline = (lastSeenAt) =>
  Boolean(lastSeenAt) && lastSeenAt >= secondsAgoLocal(DEVICE_ONLINE_SECONDS);

/**
 * Base URL of the web app players open (the QR sign and share links point
 * here). APP_URL is the same variable the password-reset emails use.
 */
export const appUrl = () =>
  (process.env.APP_URL || process.env.FRONTEND_URL || "http://localhost:4020")
    .split(",")[0]
    .trim()
    .replace(/\/+$/, "");

/** Public page for a court's QR sign — CR-027: where a player starts a game. */
export const courtQrUrl = (qrToken) => `${appUrl()}/court/${qrToken}`;

/** PLAN-003: a venue's public booking page (its online booking link). */
export const bookingPageUrl = (bookingToken) => `${appUrl()}/book/${bookingToken}`;

/** Public page for a clip's share link. */
export const clipShareUrl = (shareToken) => `${appUrl()}/clip/${shareToken}`;

/** Public page for a recording session's share link (all its parts). */
export const sessionShareUrl = (shareToken) => `${appUrl()}/session/${shareToken}`;

/** The page a player opens on their own phone to add their live stream (PLAN-002 Phase G). */
export const streamSetupUrl = (code) => `${appUrl()}/stream/${code}`;
