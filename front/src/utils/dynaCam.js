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

/**
 * CR-018: where a game's "your game is in Google Drive" email stands
 * (session.driveEmail from the API) → the line staff read.
 */
export const driveEmailText = (driveEmail) => {
  if (!driveEmail) return "";
  switch (driveEmail.status) {
    case "NoEmail":
      return "No email — add one to send the player the Google Drive link";
    case "WaitingForGame":
      return "The Google Drive link is emailed once the game ends and its videos are in Drive";
    case "WaitingForPayment":
      return "The Google Drive link is emailed once the game is paid";
    case "WaitingForDrive":
      return "The Google Drive link is emailed once its videos finish uploading to Drive";
    case "Queued":
      return driveEmail.error
        ? `Sending again shortly — last try: ${driveEmail.error}`
        : "Sending the Google Drive link shortly";
    case "NotSetUp":
      return "Ready to email, but email isn't set up on the server (SendGrid key missing)";
    case "Sending":
      return "Sending the Google Drive link…";
    case "Sent":
      return `Google Drive link emailed to ${driveEmail.to}${
        driveEmail.sentAt ? ` · ${formatDateTime(driveEmail.sentAt)}` : ""
      }${driveEmail.error ? ` (last resend failed: ${driveEmail.error})` : ""}`;
    case "Failed":
      return `Couldn't email the Google Drive link: ${driveEmail.error || "sending failed"}`;
    case "NoDrive":
      return "Not emailed — this game has no Google Drive copy";
    default:
      return "";
  }
};

/**
 * CR-018 (2026-11-20): the game's Google Drive upload (session.driveUpload) →
 * a short line for staff, or "" when there's nothing to say.
 */
export const driveUploadText = (driveUpload) => {
  if (!driveUpload) return "";
  switch (driveUpload.status) {
    case "Uploading":
      return "Uploading to Google Drive";
    case "Failed":
      return `Google Drive upload failed${driveUpload.error ? `: ${driveUpload.error}` : ""}`;
    case "NotUploaded":
      return "Not in Google Drive";
    case "Uploaded":
      return "In Google Drive";
    default:
      return "";
  }
};

/** CR-018: the row-menu label for sending the Drive-link email, by its state. */
export const driveEmailActionLabel = (status) =>
  status === "Sent" ? "Send email again" : status === "Failed" ? "Re-send email" : "Send email now";

/** CR-018: Send Drive link (again) is possible in these states. */
export const DRIVE_EMAIL_SENDABLE = ["Queued", "Sent", "Failed"];

/* ── Recording sessions ──────────────────────────────────────────────────── */

/** Session status → StatusDot tone. Recording gets the live (glowing) dot. */
export const SESSION_STATUS_TONE = {
  Waiting: "muted", // CR-005: a game waiting for its device
  Scheduled: "muted",
  Recording: "success",
  Processing: "warning",
  Ready: "success",
  Failed: "error",
  Cancelled: "muted",
};

/** CR-005: a game recording this long is highlighted in Admin (someone forgot End game?). */
export const LONG_GAME_MINUTES = 180;

/** The length choices in the booking drawer, in minutes. */
export const SESSION_DURATIONS = [30, 60, 90, 120, 180];
/** CR-016: a game time on New game is 5 min to 3 h (the API's limits)… */
export const SESSION_MIN_MINUTES = 5;
export const SESSION_MAX_MINUTES = 180;
/** …and Add time can stretch it to 6 h in all. */
export const GAME_MAX_TOTAL_MINUTES = 360;
/** CR-016: the game time New game opens with. */
export const DEFAULT_GAME_MINUTES = 60;
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
export const venuePath = (venueId) => `${VENUES_PATH}/${venueId}`;
export const courtSetupPath = (venueId, courtId) =>
  `${venuePath(venueId)}/courts/${courtId}`;
/** The printable A5 sign — full page, opened in its own tab. */
/** PLAN-003: the printable A5 "Book a court" sign for a venue's booking link. */
export const bookingSignPath = (venueId) => `${venuePath(venueId)}/booking-sign`;

/* ── Court booking (PLAN-003) ────────────────────────────────────────────── */

/**
 * DGSports → Bookings; `?booking=<id>` opens that booking. A child of the
 * sidebar's `dyna-cam` group, so AdminRoute mounts it at /admin/dyna-cam/…
 * (BUG-008: it was /admin/bookings, which has no route).
 */
export const BOOKINGS_PATH = "/admin/dyna-cam/bookings";
export const bookingPath = (bookingId) => `${BOOKINGS_PATH}?booking=${bookingId}`;

/** Booking status → what staff read, and its StatusDot tone. */
export const BOOKING_STATUS_LABEL = {
  Pending: "Unpaid hold",
  Confirmed: "Confirmed",
  CheckedIn: "Checked in",
  Completed: "Played",
  NoShow: "No-show",
  Cancelled: "Cancelled",
  Expired: "Hold expired",
  Deleted: "Deleted",
};
export const BOOKING_STATUS_TONE = {
  Pending: "warning",
  Confirmed: "success",
  CheckedIn: "success",
  Completed: "muted",
  NoShow: "error",
  Cancelled: "muted",
  Expired: "muted",
  Deleted: "muted",
};
/** PLAN-006: booking status as the player reads it in their game log. */
export const PLAYER_BOOKING_STATUS_LABEL = {
  Pending: "Waiting for payment",
  Confirmed: "Confirmed",
  CheckedIn: "Checked in",
  Completed: "Played",
  NoShow: "Missed",
  Cancelled: "Cancelled",
};

/** PLAN-006: a game's status as the player reads it in their game log. */
export const PLAYER_GAME_STATUS_LABEL = {
  Waiting: "Waiting to start",
  Scheduled: "Starting soon",
  Recording: "Recording now",
  Processing: "Getting the videos ready",
  Ready: "Videos ready",
  Failed: "Videos couldn't be saved",
};

/** paymentStatus → label. */
export const BOOKING_PAYMENT_LABEL = {
  Unpaid: "Unpaid",
  Paid: "Paid",
  Refunded: "Refunded",
  Free: "Free",
};

/** dayOfWeek 0 = Sunday … 6 = Saturday, as the API stores it. */
export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Monday first — how the week reads on the venue's forms. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** "17:00" → "5 PM", "00:00" → "12 AM", "24:00" → "12 AM (midnight)". */
export const formatHour = (hhmm) => {
  const hour = Number(String(hhmm).slice(0, 2));
  if (hour === 24) return "Midnight";
  const suffix = hour < 12 ? "AM" : "PM";
  return `${hour % 12 === 0 ? 12 : hour % 12} ${suffix}`;
};

/** Every bookable start ("00:00" … "23:00") and end ("01:00" … "24:00"). */
export const START_HOURS = Array.from(
  { length: 24 },
  (_, h) => `${String(h).padStart(2, "0")}:00`,
);
export const END_HOURS = Array.from(
  { length: 24 },
  (_, h) => `${String(h + 1).padStart(2, "0")}:00`,
);

/**
 * [1, 2, 3, 4, 5] → "Mon–Fri", [0, 6] → "Sat, Sun", all seven → "Every day".
 * Runs of 3+ days (Monday-first) collapse to a range.
 */
export const formatDays = (days = []) => {
  const set = new Set(days.map(Number));
  if (set.size === 7) return "Every day";
  const ordered = WEEK_ORDER.filter((d) => set.has(d));
  const parts = [];
  let i = 0;
  while (i < ordered.length) {
    let j = i;
    while (
      j + 1 < ordered.length &&
      WEEK_ORDER.indexOf(ordered[j + 1]) === WEEK_ORDER.indexOf(ordered[j]) + 1
    ) {
      j += 1;
    }
    if (j - i >= 2) {
      parts.push(`${WEEKDAY_SHORT[ordered[i]]}–${WEEKDAY_SHORT[ordered[j]]}`);
    } else {
      for (let k = i; k <= j; k += 1) parts.push(WEEKDAY_SHORT[ordered[k]]);
    }
    i = j + 1;
  }
  return parts.join(", ");
};

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

/**
 * What a live stream shows on a court with two cameras (Phase H): one camera
 * copied as it comes, or both stacked (Cam 1 over Cam 2) and re-encoded.
 */
export const STREAM_LAYOUTS = ["CAM1", "CAM2", "STACKED"];
export const STREAM_LAYOUT_LABEL = {
  CAM1: "Cam 1",
  CAM2: "Cam 2",
  STACKED: "Both (stacked)",
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

/**
 * The venue's court stream as the recorder box reports it
 * (`camera.live.streamStatus` / `streamMessage`) → { label, tone, note } for
 * a StatusDot line. `note` is extra detail worth showing under it (e.g.
 * "Live on YouTube", or a fallback like "Camera 2 has no video — showing
 * Camera 1").
 */
export const courtStreamHealth = (live) => {
  const message = String(live?.streamMessage || "").trim() || null;
  switch (live?.streamStatus) {
    case "starting":
      return { label: "Connecting…", tone: "warning", note: message };
    case "live":
      return {
        label: "Live",
        tone: "success",
        // "Live" alone adds nothing
        note: message && message.toLowerCase() !== "live" ? message : null,
      };
    case "error":
      return {
        label: `Problem: ${message || "the stream stopped"}`,
        tone: "error",
        note: null,
      };
    default:
      return {
        label: "Not running — is the venue's recorder box on?",
        tone: "muted",
        note: null,
      };
  }
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
  streamEnabled: !!court?.stream?.enabled,
  streamWatchUrl: court?.stream?.watchUrl || "",
  // CAM2 / STACKED need camera 2 (the API answers 400 otherwise)
  streamLayout: court?.camera2?.configured ? court?.streamLayout || "CAM1" : "CAM1",
  removeCamera: false,
  removeCamera2: false,
  removeStream: false,
  ...overrides,
});

/** CR-038: the TV court board's colours (grid blocks and legend) — booked orange, in play blue, played grey. */
export const BOARD_TONE = {
  free: "var(--color-success)",
  booked: "var(--color-warning)",
  playing: "var(--color-link)",
  done: "var(--color-text-muted)",
};
