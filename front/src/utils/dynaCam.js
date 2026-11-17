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
  BUTTON: "Court button",
  SESSION: "Session",
  STAFF: "Staff",
};
