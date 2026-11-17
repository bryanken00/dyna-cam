/**
 * Display helpers shared by the Dyna Cam admin and player pages (PLAN-001).
 *
 * API timestamps are Asia/Manila "YYYY-MM-DD HH:mm:ss" strings with no zone, so
 * dayjs reads them as browser-local time. Shown as-is they read correctly
 * (venue time); relative times ("2 minutes ago") are only exact for browsers
 * on Manila time.
 */
import dayjs from "dayjs";

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
