/**
 * Display and timing helpers for the session device (PLAN-002 Phase E).
 *
 * ── Time ────────────────────────────────────────────────────────────────────
 * Every API timestamp is an Asia/Manila wall-clock string, "YYYY-MM-DD
 * HH:mm:ss", with no zone attached. They are parsed by hand rather than with
 * `new Date(…)`: Hermes does not reliably parse the space-separated form, and
 * a Date would shift the time into the device's own zone. Shown as-is they
 * read as venue time. Manila has no daylight saving, so it is UTC + 8 hours.
 *
 * Running timers never use the device clock against an API time: they tick
 * from a server "…Seconds" value plus the time since that response arrived
 * (`tickSeconds`), so a device with the wrong clock or zone still counts right.
 */


const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

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

/** A Manila timestamp → "2:30 PM" ("-" when it isn't one). */
export const formatTime = (value) => {
  const p = parseLocal(value);
  if (!p) return "-";
  return `${p.h % 12 === 0 ? 12 : p.h % 12}:${pad(p.mi)} ${p.h < 12 ? "AM" : "PM"}`;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** CR-015: a Manila timestamp → "Nov 19" ("-" when it isn't one). */
export const formatDay = (value) => {
  const p = parseLocal(value);
  if (!p) return "-";
  return `${MONTHS[p.mo - 1]} ${p.d}`;
};

/**
 * A venue's clock time "HH:MM" → "6 AM" / "6:30 PM". CR-049: hours past
 * midnight come as "24:00", "25:00"… (the evening's day) → "12 AM", "1 AM".
 */
export const formatClock = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm ?? ""));
  if (!m) return "-";
  const h = Number(m[1]) % 24;
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${m[2] === "00" ? "" : `:${m[2]}`} ${h < 12 ? "AM" : "PM"}`;
};

/** { opensAt, closesAt } → "6 AM – 1 AM"; "Open 24 hours" for 00:00–24:00. */
export const formatHours = ({ opensAt, closesAt } = {}) => {
  if (opensAt === "00:00" && closesAt === "24:00") return "Open 24 hours";
  return `${formatClock(opensAt)} – ${formatClock(closesAt)}`;
};

/** A running timer / countdown: 754 → "12:34", 3754 → "1:02:34". */
export const formatElapsed = (seconds) => {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
};

/**
 * Seconds passed since a response arrived (`dataUpdatedAt`, a device-clock
 * epoch — comparing it with Date.now() is safe, unlike API times).
 */
export const secondsSince = (dataUpdatedAt, now = Date.now()) =>
  Math.max(0, Math.floor((now - (dataUpdatedAt || now)) / 1000));

/**
 * CR-017: how long a game's videos are kept, from the API's `keepDays`
 * (1 → "24 hours", 3 → "3 days"); null when the API doesn't say.
 */
export const keepTimeText = (keepDays) => {
  const days = Math.floor(Number(keepDays) || 0);
  if (days < 1) return null;
  return days === 1 ? "24 hours" : `${days} days`;
};

/** "https://dynacam.ph/session/Ab3…" → "dynacam.ph/session/Ab3…" — what's worth reading out. */
export const shortLink = (url) => String(url ?? "").replace(/^https?:\/\//, "");

/** CR-015: a game's code as typed — no spaces, upper case ("k7q m2p" → "K7QM2P"). */
export const normalizePayCode = (value) => String(value ?? "").replace(/\s+/g, "").toUpperCase();

/** CR-015: "K7QM2P" → "K7Q M2P" — easier to read out at the desk (as on the web). */
export const formatPayCode = (code) =>
  (normalizePayCode(code).match(/.{1,3}/g) || []).join(" ");

/** CR-015: the API's rule for a code, after normalising. */
export const PAY_CODE_PATTERN = /^[A-Z0-9]{4,12}$/;

/* ── Connection ──────────────────────────────────────────────────────────── */

/**
 * True when an error means "couldn't reach the API" rather than "the API
 * said no": no response at all (Wi-Fi down, server unreachable, timeout) or
 * a 5xx. Screens show "Can't reach Dyna Cam — retrying" for these and keep
 * polling; they never unpair the device over one.
 */
export const isConnectionError = (error) => {
  if (!error) return false;
  const status = error.response?.status;
  return !status || status >= 500;
};

/* ── Live-video links (signed, expiring HLS from the recorder box) ───────── */

/**
 * The part of a live link that identifies the stream — "http://host:port/path",
 * without the query (`exp`, `sig`). Two links with the same identity play the
 * same stream; only the signature differs.
 */
export const liveIdentity = (url) => {
  const m = /^(https?:\/\/[^/?#]+)([^?#]*)/.exec(String(url ?? ""));
  return m ? `${m[1]}${m[2]}` : null;
};

/**
 * When a live link stops working, as an epoch in ms. Read from the link's own
 * `exp` (Unix seconds — what the box checks), falling back to `expiresAt`
 * (an epoch, an ISO string, or a Manila wall-clock string). null if unknown.
 */
export const liveExpiryMs = (live) => {
  const exp = /[?&]exp=(\d+)/.exec(String(live?.hlsUrl ?? ""))?.[1];
  if (exp) return Number(exp) * (exp.length > 11 ? 1 : 1000);

  const at = live?.expiresAt;
  if (at == null) return null;
  if (typeof at === "number" || /^\d+$/.test(String(at))) {
    const n = Number(at);
    return n > 1e12 ? n : n * 1000;
  }
  const p = parseLocal(at);
  if (p && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(String(at))) {
    return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - MANILA_OFFSET_MS;
  }
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? null : ms;
};


