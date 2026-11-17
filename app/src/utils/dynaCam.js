import { BASE_URL } from "../constants";

/**
 * Display helpers for the Dyna Cam staff screens (PLAN-001) — the app's copy
 * of `front/src/utils/dynaCam.js`, without dayjs.
 *
 * ── Time ────────────────────────────────────────────────────────────────────
 * Every API timestamp is an Asia/Manila wall-clock string, "YYYY-MM-DD
 * HH:mm:ss", with no zone attached. They are parsed here by hand rather than
 * with `new Date(…)`, for two reasons: Hermes does not reliably parse the
 * space-separated form, and a Date would shift the time into the phone's own
 * zone. Shown as-is they read as venue time, which is what staff standing at
 * the court expect.
 *
 * Manila has had no daylight saving since 1978, so "Manila now" is simply UTC
 * + 8 hours — no Intl time-zone lookup needed.
 */

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pad = (n) => String(n).padStart(2, "0");

/** "2026-11-17 14:30:05" → { y, mo, d, h, mi, s }, or null if it isn't one. */
export const parseLocal = (value) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(
    String(value ?? ""),
  );
  if (!m) return null;
  return {
    y: Number(m[1]),
    mo: Number(m[2]),
    d: Number(m[3]),
    h: Number(m[4]),
    mi: Number(m[5]),
    s: Number(m[6] ?? 0),
  };
};

/** A Manila timestamp as epoch milliseconds (null when empty). */
export const toEpochMs = (value) => {
  const p = parseLocal(value);
  if (!p) return null;
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - MANILA_OFFSET_MS;
};

/** The Manila wall clock as a Date whose UTC fields read as Manila time. */
const manilaWall = (offsetMs = 0) =>
  new Date(Date.now() + offsetMs + MANILA_OFFSET_MS);

const wallDate = (w) =>
  `${w.getUTCFullYear()}-${pad(w.getUTCMonth() + 1)}-${pad(w.getUTCDate())}`;

/**
 * "Now" as Manila wall-clock time — the zone the API books in — whatever the
 * phone's own zone is. → { date: "YYYY-MM-DD", time: "HH:mm" }
 */
export const manilaNow = (offsetMinutes = 0) => {
  const w = manilaWall(offsetMinutes * 60 * 1000);
  return {
    date: wallDate(w),
    time: `${pad(w.getUTCHours())}:${pad(w.getUTCMinutes())}`,
  };
};

/** The next `count` Manila dates, starting today → ["YYYY-MM-DD", …]. */
export const manilaDays = (count) =>
  Array.from({ length: count }, (_, i) =>
    wallDate(manilaWall(i * 24 * 60 * 60 * 1000)),
  );

const hour12 = (h, mi) =>
  `${h % 12 === 0 ? 12 : h % 12}:${pad(mi)} ${h < 12 ? "AM" : "PM"}`;

/** "14:30" or a timestamp → "2:30 PM". */
export const formatTime = (value) => {
  const hm = /^(\d{2}):(\d{2})$/.exec(String(value ?? ""));
  if (hm) return hour12(Number(hm[1]), Number(hm[2]));
  const p = parseLocal(value);
  return p ? hour12(p.h, p.mi) : "-";
};

/** "2026-11-17" → "Today" / "Tomorrow" / "Thu, Nov 19". */
export const formatDayLabel = (date) => {
  const today = manilaNow().date;
  if (date === today) return "Today";
  if (date === manilaNow(24 * 60).date) return "Tomorrow";
  const [y, mo, d] = String(date).split("-").map(Number);
  if (!y) return "-";
  const weekday = WEEKDAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  return `${weekday}, ${MONTHS[mo - 1]} ${d}`;
};

/** "Nov 17, 2026", or "-" when empty. */
export const formatDate = (value) => {
  const p = parseLocal(value) ?? parseLocal(`${value} 00:00`);
  return p ? `${MONTHS[p.mo - 1]} ${p.d}, ${p.y}` : "-";
};

/**
 * Compact date and time: "Today, 2:30 PM", "Yesterday, 9:05 AM",
 * "Nov 3, 4:00 PM" (this year) or "Nov 3, 2025, 4:00 PM".
 */
export const formatDateTime = (value) => {
  const p = parseLocal(value);
  if (!p) return "-";
  const date = `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
  const time = hour12(p.h, p.mi);
  if (date === manilaNow().date) return `Today, ${time}`;
  if (date === manilaNow(-24 * 60).date) return `Yesterday, ${time}`;
  const thisYear = manilaWall().getUTCFullYear();
  return p.y === thisYear
    ? `${MONTHS[p.mo - 1]} ${p.d}, ${time}`
    : `${MONTHS[p.mo - 1]} ${p.d}, ${p.y}, ${time}`;
};

/** "2:00 PM – 3:30 PM" on one day, with dates when it crosses midnight. */
export const formatTimeRange = (startAt, endAt) => {
  const a = parseLocal(startAt);
  const b = parseLocal(endAt);
  if (!a || !b) return "-";
  const sameDay = a.y === b.y && a.mo === b.mo && a.d === b.d;
  return sameDay
    ? `${hour12(a.h, a.mi)} – ${hour12(b.h, b.mi)}`
    : `${MONTHS[a.mo - 1]} ${a.d}, ${hour12(a.h, a.mi)} – ${MONTHS[b.mo - 1]} ${b.d}, ${hour12(b.h, b.mi)}`;
};

/** 90 → "1 h 30 min", 45 → "45 min". */
export const formatMinutes = (minutes) => {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (!h) return `${rest} min`;
  return rest ? `${h} h ${rest} min` : `${h} h`;
};

/** 60 → "1:00", 75 → "1:15". */
export const formatDuration = (seconds) => {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
};

/** A running timer: 754 → "12:34", 3754 → "1:02:34". */
export const formatElapsed = (seconds) => {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
};

/**
 * A server "seconds" value, ticked forward locally since the response
 * arrived: `elapsedSeconds` + (now − dataUpdatedAt). The phone's clock and
 * zone don't matter — only the time since the answer does.
 */
export const tickSeconds = (seconds, dataUpdatedAt, now = Date.now()) =>
  Number(seconds || 0) +
  Math.max(0, Math.floor((now - (dataUpdatedAt || now)) / 1000));

/** A game's length for a label: 2520 → "42 min", 5400 → "1 h 30 min". */
export const formatGameLength = (seconds) =>
  formatMinutes(Math.max(1, Math.round((Number(seconds) || 0) / 60)));

/** 1536000 → "1.5 MB". */
export const formatBytes = (bytes) => {
  const n = Number(bytes);
  if (!n) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let value = n;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
};

/**
 * A server-computed age ("lastSeenSecondsAgo") → "Seen just now",
 * "Seen 4 min ago", "Never seen". The API does the subtraction so the phone's
 * clock and zone don't matter.
 */
export const formatSeenAgo = (seconds) => {
  if (seconds === null || seconds === undefined) return "Never seen";
  const s = Number(seconds);
  if (s < 60) return "Seen just now";
  if (s < 3600) return `Seen ${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `Seen ${Math.floor(s / 3600)} h ago`;
  return `Seen ${Math.floor(s / 86400)} d ago`;
};

/** A session part's 1-based label: partIndex 0 → "Part 1". */
export const partLabel = (partIndex) => `Part ${(Number(partIndex) || 0) + 1}`;

/* ── Money and pay codes ─────────────────────────────────────────────────── */

/** 50 → "₱50", 49.5 → "₱49.50", 1250 → "₱1,250". Decimals only when needed. */
export const formatPeso = (amount) => {
  const n = Number(amount) || 0;
  const whole = Math.round(n * 100) % 100 === 0;
  return `₱${n.toLocaleString("en-PH", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
};

/** What a player types or reads out → the stored form: "k7q m2p" → "K7QM2P". */
export const normalizePayCode = (value) =>
  String(value || "").replace(/\s+/g, "").toUpperCase();

/** "K7QM2P" → "K7Q M2P" — easier to read out at the desk. */
export const formatPayCode = (code) =>
  (normalizePayCode(code).match(/.{1,3}/g) || []).join(" ");

/** The API's pay-code rule, after normalising. */
export const PAY_CODE_PATTERN = /^[A-Z0-9]{4,12}$/;

/** Clip statuses a payment can still be taken for (same list as the API). */
export const PAYABLE_CLIP_STATUSES = ["Pending", "Processing", "Ready"];

/* ── Status vocabularies → StatusChip tones ──────────────────────────────── */

export const CLIP_STATUS_TONE = {
  Pending: "warning",
  Processing: "warning",
  Ready: "success",
  Failed: "danger",
  Expired: "muted",
  Deleted: "muted",
};

export const CLIP_SOURCE_LABEL = {
  QR: "QR scan",
  BUTTON: "Button",
  SESSION: "Session",
  STAFF: "Staff",
};

export const PAYMENT_STATUS_TONE = {
  Free: "muted",
  Unpaid: "warning",
  Paid: "success",
  Refunded: "muted",
};

export const SESSION_STATUS_TONE = {
  Scheduled: "muted",
  Recording: "success",
  Processing: "warning",
  Ready: "success",
  Failed: "danger",
  Cancelled: "muted",
};

/** Heartbeat camera status (edge/) → tone + label. */
export const CAMERA_STATE = {
  ok: { tone: "success", label: "Recording" },
  starting: { tone: "warning", label: "Starting" },
  error: { tone: "danger", label: "Error" },
};

/* ── Sessions ────────────────────────────────────────────────────────────── */

/** The length choices when booking, in minutes (API: 5–180). */
export const SESSION_DURATIONS = [30, 60, 90, 120, 180];

/** How far ahead the API lets a session be booked. */
export const SESSION_MAX_DAYS_AHEAD = 14;

/* ── Files ───────────────────────────────────────────────────────────────── */

/**
 * The API returns uploads as signed, expiring RELATIVE links
 * ("/public/uploads/…?expires=…&signature=…"). Prefix the API host and use
 * the rest exactly as given — a path without its signature is refused.
 */
export const fileUrl = (path) => {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return `${BASE_URL}${path}`;
};

/* ── Connection ──────────────────────────────────────────────────────────── */

/**
 * True when an error means "couldn't reach the API" rather than "the API
 * said no": no response at all (Wi-Fi down, server unreachable, timeout) or
 * a 5xx. Paired screens show "Can't reach Dyna Cam — retrying" for these and
 * keep retrying; they never unpair the phone over one.
 */
export const isConnectionError = (error) => {
  if (!error) return false;
  const status = error.response?.status;
  return !status || status >= 500;
};
