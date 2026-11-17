/**
 * Display helpers shared by the Dyna Cam admin and player pages (PLAN-001).
 *
 * API timestamps are Asia/Manila "YYYY-MM-DD HH:mm:ss" strings with no zone, so
 * dayjs reads them as browser-local time. Shown as-is they read correctly
 * (venue time); relative times ("2 minutes ago") are only exact for browsers
 * on Manila time.
 */
import dayjs from "dayjs";
import { decodeHTML } from "./decode-html";

/** 60 → "1:00", 75 → "1:15". */
export const formatDuration = (seconds) => {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

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

/** "Nov 17, 2026 2:30 PM", or "-" when empty. */
export const formatDateTime = (value) =>
  value ? dayjs(value).format("MMM D, YYYY h:mm A") : "-";

/** "Nov 17, 2026", or "-" when empty. */
export const formatDate = (value) =>
  value ? dayjs(value).format("MMM D, YYYY") : "-";

/** Clip status → StatusDot tone. */
export const CLIP_STATUS_TONE = {
  Pending: "warning",
  Processing: "warning",
  Ready: "success",
  Failed: "error",
  Expired: "muted",
  Deleted: "muted",
};

/** Clip source → the label staff read. */
export const CLIP_SOURCE_LABEL = {
  QR: "QR scan",
  BUTTON: "Button",
  SESSION: "Session",
  STAFF: "Staff",
};

/* ── Court buttons ───────────────────────────────────────────────────────── */

/** Same rule as the API: 3–32 letters, digits, "-" or "_". */
export const BUTTON_CODE_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;
export const BUTTON_CODE_MAX = 32;

/** The recorder box's LAN listener port for Wi-Fi button presses. */
export const BUTTON_PRESS_PORT = 8089;

/** "Dink City Pickleball" → "dink-city-pickleball". */
const slugify = (value) =>
  String(value || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * Suggest a court button code: `<venue-slug>-<court-slug>`, lowercase, cut to
 * fit 32 characters by shortening the venue part first.
 *
 *   suggestButtonCode("Dink City Pickleball", "Court 1") → "dink-city-pickleball-court-1"
 */
export const suggestButtonCode = (venueName, courtName) => {
  const court = slugify(courtName) || "court";
  const venue = slugify(venueName);
  if (!venue) return court.slice(0, BUTTON_CODE_MAX);
  const room = BUTTON_CODE_MAX - court.length - 1;
  if (room < 3) return court.slice(0, BUTTON_CODE_MAX);
  const venuePart = venue.slice(0, room).replace(/-+$/, "");
  return `${venuePart}-${court}`;
};

/* ── Recording sessions ──────────────────────────────────────────────────── */

/** Session status → StatusDot tone. Recording gets the live (glowing) dot. */
export const SESSION_STATUS_TONE = {
  Scheduled: "muted",
  Recording: "success",
  Processing: "warning",
  Ready: "success",
  Failed: "error",
  Cancelled: "muted",
};

/** The length choices in the booking drawer, in minutes. */
export const SESSION_DURATIONS = [30, 60, 90, 120, 180];
export const SESSION_MIN_MINUTES = 5;
export const SESSION_MAX_MINUTES = 180;
export const SESSION_MAX_DAYS_AHEAD = 14;

/** 90 → "1 h 30 min", 45 → "45 min". */
export const formatMinutes = (minutes) => {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (!h) return `${rest} min`;
  return rest ? `${h} h ${rest} min` : `${h} h`;
};

/** "2:00 PM – 3:30 PM" (both on one day) or with dates when it crosses midnight. */
export const formatTimeRange = (startAt, endAt) => {
  if (!startAt || !endAt) return "-";
  const start = dayjs(startAt);
  const end = dayjs(endAt);
  return start.isSame(end, "day")
    ? `${start.format("h:mm A")} – ${end.format("h:mm A")}`
    : `${start.format("MMM D, h:mm A")} – ${end.format("MMM D, h:mm A")}`;
};

/** A session part's 1-based label: partIndex 0 → "Part 1". */
export const partLabel = (partIndex) =>
  `Part ${(Number(partIndex) || 0) + 1}`;

/**
 * "Now" as Manila wall-clock time — the zone the API books in — whatever the
 * browser's own zone is. → { date: "YYYY-MM-DD", time: "HH:mm" }
 */
export const manilaNow = (offsetMinutes = 0) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(Date.now() + offsetMinutes * 60 * 1000))
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
};

/* ── Clip payments (cash at the front desk) ──────────────────────────────── */

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

/** Clip payment status → StatusDot tone. */
export const PAYMENT_STATUS_TONE = {
  Free: "muted",
  Unpaid: "warning",
  Paid: "success",
  Refunded: "muted",
};

/* ── Setup menu paths (PLAN-002) ─────────────────────────────────────────── */

export const VENUES_PATH = "/admin/setup/venues";
export const RECORDER_BOXES_PATH = "/admin/setup/recorder-boxes";
export const venuePath = (venueId) => `${VENUES_PATH}/${venueId}`;
export const courtSetupPath = (venueId, courtId) =>
  `${venuePath(venueId)}/courts/${courtId}`;
/** The printable A5 sign — full page, opened in its own tab. */
export const courtSignPath = (courtId) => `/admin/setup/courts/${courtId}/print`;

/** 4 → "4 s ago", 125 → "2 min ago", 7300 → "2 h ago", 200000 → "2 days ago". */
export const formatAgo = (seconds) => {
  if (seconds === null || seconds === undefined) return "";
  if (seconds < 60) return `${seconds} s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  const days = Math.floor(seconds / 86400);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
};

/* ── A player's own live stream (PLAN-002 Phase G) ───────────────────────── */

/** Stream platform → the label players and staff read. */
export const STREAM_PLATFORM_LABEL = {
  FACEBOOK: "Facebook",
  YOUTUBE: "YouTube",
  OTHER: "Other",
};

/** An RTMP(S) address with its key, as the API accepts for "Other". */
export const RTMP_URL_PATTERN = /^rtmps?:\/\/\S+$/i;

/**
 * A session stream `{ platform, status, message }` as one line:
 * → { label, tone } for <StatusDot>.
 *   waiting  — the session hasn't started recording; it starts by itself
 *   starting — the box is connecting
 *   live     — on air
 *   error    — the box reported a problem (`message`)
 */
export const streamStatusInfo = (stream) => {
  const where =
    stream?.platform === "OTHER"
      ? "your stream server"
      : STREAM_PLATFORM_LABEL[stream?.platform] || "your channel";
  switch (stream?.status) {
    case "waiting":
      return { label: "Waiting for the game to start", tone: "muted" };
    case "starting":
      return { label: "Connecting…", tone: "warning" };
    case "live":
      return { label: `Live on ${where}`, tone: "success" };
    case "error":
      return {
        label: `Problem: ${stream?.message || "the stream stopped"}`,
        tone: "error",
      };
    default:
      return { label: stream?.status || "-", tone: "muted" };
  }
};

/* ── Pairing keys (PLAN-002) ─────────────────────────────────────────────── */

/** A pairing key works once, for this long after it is created. */
export const PAIRING_KEY_TTL_MS = 10 * 60 * 1000;

/** "482913" → "482 913" — easier to read out and type. */
export const formatPairingKey = (code) =>
  String(code || "").replace(/^(\d{3})(\d{3})$/, "$1 $2");

/* ── Camera health (from the venue's recorder box) ───────────────────────── */

/**
 * A court's camera as staff should read it:
 *   setup   — no camera address yet
 *   ok      — the box is recording it
 *   starting— the box is connecting
 *   error   — the box can't record it (see `message`)
 *   nobox   — no recorder box online for the venue, so nobody can tell
 *   switching — the box still reports the previous camera address
 * → { key, label, tone, message }
 */
export const cameraHealth = (camera) => {
  if (!camera?.configured) {
    return { key: "setup", label: "Not set up", tone: "muted", message: null };
  }
  const live = camera.live;
  if (!live || !live.boxOnline) {
    return {
      key: "nobox",
      label: "No box online",
      tone: "muted",
      message: "No recorder box is online for this venue",
    };
  }
  // The box's report describes the current address only when the versions
  // match; until then it is about the previous camera
  if (camera.version && live.cameraVersion !== camera.version) {
    return {
      key: "switching",
      label: "Switching camera",
      tone: "warning",
      message: "The recorder box hasn't picked up the new camera address yet",
    };
  }
  if (live.status === "ok") {
    return { key: "ok", label: "Recording", tone: "success", message: live.message };
  }
  if (live.status === "starting") {
    return { key: "starting", label: "Connecting", tone: "warning", message: live.message };
  }
  return { key: "error", label: "Can't reach", tone: "error", message: live.message };
};

/** What to do about a camera error message from the box. */
export const cameraFixHint = (message) => {
  const text = String(message || "");
  if (/reject|username|password|401|unauthori/i.test(text)) {
    return "Use the Camera Account from the Tapo app (Camera settings → Advanced settings → Camera Account), not your Tapo login. Re-enter the username and password below.";
  }
  if (/not found|404|path|describe/i.test(text)) {
    return "The stream path is wrong. A Tapo camera uses /stream1 (high quality) or /stream2 (low) — pick the quality again below.";
  }
  if (/not reachable|timed out|timeout|refused|unreachable|no video/i.test(text)) {
    return "Check the camera has power and is on the venue Wi-Fi, and that its IP address is reserved in the router (DHCP reservation) so it doesn't change. Then check the IP below.";
  }
  if (text) {
    return "Check the camera's address below, then give the box a minute to try again.";
  }
  return null;
};

/** "1280×720 · 15 fps · H.264 · AAC 16 kHz" from a live camera report. */
export const formatStreamDetails = (live) => {
  if (!live?.video) return null;
  const { codec, width, height, fps } = live.video;
  const videoCodec = { h264: "H.264", hevc: "H.265", h265: "H.265" }[
    String(codec || "").toLowerCase()
  ] || String(codec || "").toUpperCase();
  const parts = [];
  if (width && height) parts.push(`${width}×${height}`);
  if (fps) parts.push(`${Math.round(Number(fps) * 10) / 10} fps`);
  if (videoCodec) parts.push(videoCodec);
  if (live.audio?.codec) {
    const rate = live.audio.sampleRate
      ? ` ${Math.round(Number(live.audio.sampleRate) / 100) / 10} kHz`
      : "";
    parts.push(`${String(live.audio.codec).toUpperCase()}${rate}`);
  } else {
    parts.push("no audio");
  }
  return parts.join(" · ");
};

/* ── Court saves (PUT is a full update) ──────────────────────────────────── */

/**
 * The complete PUT body for a court, from its latest API record, with one
 * section's changes on top. The camera / stream addresses are write-only:
 * they're only sent when the caller passes them.
 */
export const courtUpdatePayload = (court, overrides = {}) => ({
  name: decodeHTML(court?.name),
  status: court?.status === "Inactive" ? "Inactive" : "Active",
  buttonCode: court?.buttonCode || "",
  streamEnabled: !!court?.stream?.enabled,
  streamWatchUrl: court?.stream?.watchUrl || "",
  removeCamera: false,
  removeStream: false,
  ...overrides,
});
