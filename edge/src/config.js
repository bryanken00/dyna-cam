import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isLoopbackHost } from "./util.js";

/** edge/ — .env and the default DATA_DIR resolve from here, not from the cwd. */
export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** The box's settings file (holds ENROLL_KEY until the box has enrolled). */
export const ENV_FILE = path.join(ROOT_DIR, ".env");

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "package.json"), "utf8"));
export const AGENT_VERSION = pkg.version;
// The API blocks requests with no User-Agent or one containing "bot"
export const USER_AGENT = `DynaCamRecorder/${pkg.version}`;

/**
 * Heartbeat `capabilities`: what this box understands beyond the base device
 * contract. "game-file" (CR-006): after End game the box takes one game job
 * per camera, copies the whole game into one mp4 and uploads it in resumable
 * chunks (/game-videos/:id/start, /chunk, /finish, /fail).
 */
export const CAPABILITY_GAME_FILE = "game-file";
/**
 * "drive-direct" (CR-040): the box keeps each game file and sends it straight to
 * the court's Google Drive (/game-videos/:id/drive-session, /progress,
 * /drive-done, /box-deleted); the API then gives game jobs `delivery: "drive"`.
 */
export const CAPABILITY_DRIVE_DIRECT = "drive-direct";
export const DEVICE_CAPABILITIES = Object.freeze([CAPABILITY_GAME_FILE, CAPABILITY_DRIVE_DIRECT]);

export const ENCODERS = ["auto", "libx264", "h264_qsv", "h264_vaapi", "h264_videotoolbox"];

export class ConfigError extends Error {}

/** Load edge/.env into process.env (real environment variables win). */
export function loadEnvFile(file = ENV_FILE) {
  try {
    process.loadEnvFile(file);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}

const int = (env, name, fallback, min, max) => {
  const raw = env[name];
  if (raw === undefined || String(raw).trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(`${name} must be a whole number from ${min} to ${max} (got "${raw}")`);
  }
  return value;
};

const bool = (env, name, fallback) => {
  const raw = String(env[name] ?? "")
    .trim()
    .toLowerCase();
  if (raw === "") return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  throw new ConfigError(`${name} must be true or false (got "${env[name]}")`);
};

/** The API's enrol key is at least this long (back: RECORDER_ENROLL_KEY). */
export const ENROLL_KEY_MIN = 32;
const VENUE_ID = /^[A-Za-z0-9-]{1,50}$/;

/**
 * How the box gets its token (credentials.js): DATA_DIR/device.json from an
 * earlier enrolment, else ENROLL_KEY + VENUE_ID (+ BOX_NAME) to enrol once.
 * Without device.json both are required.
 */
export function parseEnrollment(env, dataDir, { hostname = os.hostname } = {}) {
  const enrollKey = String(env.ENROLL_KEY ?? "").trim();
  const venueId = String(env.VENUE_ID ?? "").trim();
  const enrolled = fs.existsSync(path.join(dataDir, "device.json"));
  if (!enrollKey && !enrolled) {
    throw new ConfigError(
      "Missing ENROLL_KEY. Set ENROLL_KEY (the API's RECORDER_ENROLL_KEY) and VENUE_ID " +
        "(Setup → Venues → the venue → Copy ID) in .env — see .env.example."
    );
  }
  if (enrollKey && enrollKey.length < ENROLL_KEY_MIN) {
    throw new ConfigError(
      `ENROLL_KEY is too short (at least ${ENROLL_KEY_MIN} characters) — it must be exactly the API's RECORDER_ENROLL_KEY`
    );
  }
  if (enrollKey && !venueId) {
    throw new ConfigError(
      "Missing VENUE_ID: the ID of this box's venue (Admin → Setup → Venues → the venue → Copy ID)"
    );
  }
  if (venueId && !VENUE_ID.test(venueId)) {
    throw new ConfigError(
      "VENUE_ID must be the venue's ID as copied from Admin → Setup → Venues (letters, digits and dashes)"
    );
  }
  const boxName = (String(env.BOX_NAME ?? "").trim() || String(hostname() || "").trim()).slice(
    0,
    100
  );
  return { enrollKey: enrollKey || null, venueId: venueId || null, boxName: boxName || null };
}

/** Settings from older setups that are no longer read — warned about, never used. */
export function leftoverWarnings(settings) {
  const hint = "a box enrols with ENROLL_KEY and VENUE_ID (see .env.example)";
  return [
    settings.ignoredDeviceToken &&
      `DEVICE_TOKEN in .env is no longer used — ${hint}. You can delete the DEVICE_TOKEN line.`,
    settings.ignoredPairingCode &&
      `PAIRING_CODE in .env is no longer used — ${hint}. You can delete the PAIRING_CODE line.`,
    settings.ignoredButtons &&
      "BUTTON_PORT / BUTTON_HOST / BUTTON_KEY in .env are no longer used — court buttons were " +
        "removed and the box no longer listens for them. You can delete those lines.",
  ].filter(Boolean);
}

/**
 * LIVE_HOST: the address phones use to reach the box (an IPv4, a host name or
 * a bracketed IPv6), no scheme or port. Empty → null (detected from the network).
 */
export function parseLiveHost(raw) {
  const host = String(raw ?? "").trim();
  if (!host) return null;
  if (host.length > 253 || !/^([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])$/.test(host)) {
    throw new ConfigError(
      `LIVE_HOST must be the box's LAN address only, like 192.168.1.50 (got "${host}")`
    );
  }
  return host;
}

/**
 * Is `hostname` (`new URL(…).hostname`) this machine — loopback or one of its own
 * addresses? Plain http:// to the API is allowed only then: the traffic never
 * leaves the machine (`./run.sh edge` points the box at the local API by LAN IP).
 */
export function isThisMachine(hostname, interfaces = os.networkInterfaces) {
  if (isLoopbackHost(hostname)) return true;
  const host = String(hostname)
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  return Object.values(interfaces() || {})
    .flat()
    .some((entry) => String(entry?.address ?? "").toLowerCase() === host);
}

/** Read and check the settings. Throws ConfigError with a message meant for a person. */
export function loadConfig(env = process.env, { interfaces = os.networkInterfaces } = {}) {
  const apiUrl = String(env.API_URL ?? "")
    .trim()
    .replace(/\/+$/, "");
  // DEVICE_TOKEN (Phase F) and PAIRING_CODE (Phase I) are no longer read —
  // index.js only warns when one is still set
  const ignoredDeviceToken = String(env.DEVICE_TOKEN ?? "").trim() !== "";
  const ignoredPairingCode = String(env.PAIRING_CODE ?? "").trim() !== "";
  // CR-044: the court-button listener is gone (CR-027 removed the buttons)
  const ignoredButtons = ["BUTTON_PORT", "BUTTON_HOST", "BUTTON_KEY"].some((name) => name in env);
  if (!apiUrl) {
    throw new ConfigError(
      "Missing API_URL. Copy .env.example to .env and set API_URL, ENROLL_KEY and VENUE_ID."
    );
  }
  let parsed;
  try {
    parsed = new URL(apiUrl);
  } catch (_err) {
    throw new ConfigError(`API_URL is not a valid URL (got "${apiUrl}")`);
  }
  // CR-044: the token, camera passwords and stream keys travel on this link —
  // plain http only to an API on this same machine (local testing)
  const sameMachine = parsed.protocol === "http:" && isThisMachine(parsed.hostname, interfaces);
  if (parsed.protocol !== "https:" && !sameMachine) {
    throw new ConfigError(
      `API_URL must start with https:// (got "${parsed.protocol}//${parsed.host}"). ` +
        "Plain http:// is only allowed for an API on this same machine (local testing)."
    );
  }
  // Certificate checks stay on: a box that trusts any certificate can be fooled into
  // sending its token and the camera passwords to someone else
  if (String(env.NODE_TLS_REJECT_UNAUTHORIZED ?? "").trim() === "0") {
    throw new ConfigError(
      "NODE_TLS_REJECT_UNAUTHORIZED=0 turns off HTTPS certificate checks — remove it from the environment / .env"
    );
  }

  const encoder = String(env.ENCODER || "auto").trim();
  if (!ENCODERS.includes(encoder)) {
    throw new ConfigError(`ENCODER must be one of ${ENCODERS.join(", ")} (got "${encoder}")`);
  }
  const logLevel = String(env.LOG_LEVEL || "info").trim();
  // Live view on the LAN: unset → 8090; set to "" or 0 → off
  const livePort = env.LIVE_PORT === undefined ? 8090 : int(env, "LIVE_PORT", 0, 0, 65535);
  const liveHost = parseLiveHost(env.LIVE_HOST);
  const bufferSeconds = int(env, "BUFFER_SECONDS", 180, 90, 3600);
  // HTTPS live view (CR-002): a folder with privkey.pem, cert.pem (+ chain.pem), like back's certPath
  const certRaw = String(env.CERT_PATH ?? "").trim();
  const certPath = certRaw ? path.resolve(ROOT_DIR, certRaw) : null;
  const dataDir = path.resolve(ROOT_DIR, env.DATA_DIR || "./data");
  const { enrollKey, venueId, boxName } = parseEnrollment(env, dataDir);

  return Object.freeze({
    apiUrl,
    ignoredDeviceToken,
    ignoredPairingCode,
    ignoredButtons,
    enrollKey,
    venueId,
    boxName,
    dataDir,
    segmentSeconds: int(env, "SEGMENT_SECONDS", 2, 1, 10),
    // A clip needs 65 s plus the time the job takes to reach the box
    bufferSeconds,
    // CR-014: how far back the live view can be rewound on the session device —
    // the live playlist lists this much of the buffer (kept 30 s inside it)
    liveDvrSeconds: Math.min(int(env, "LIVE_DVR_SECONDS", 60, 10, 3600), bufferSeconds - 30),
    encoder,
    vaapiDevice: env.VAAPI_DEVICE || "/dev/dri/renderD128",
    recordAudio: bool(env, "RECORD_AUDIO", true),
    clipConcurrency: int(env, "CLIP_CONCURRENCY", 1, 1, 4),
    uploadConcurrency: int(env, "UPLOAD_CONCURRENCY", 1, 1, 4),
    heartbeatSeconds: int(env, "HEARTBEAT_SECONDS", 30, 5, 600),
    configRefreshSeconds: int(env, "CONFIG_REFRESH_SECONDS", 60, 10, 3600),
    // Free space in DATA_DIR: warn below, stop keeping game footage below critical
    diskWarnGb: int(env, "DISK_WARN_GB", 2, 0, 10_000),
    diskCriticalMb: int(env, "DISK_CRITICAL_MB", 500, 0, 1_000_000),
    livePort,
    liveHost,
    certPath,
    // Stacked (two-camera, re-encoded) live streams at once, court and player streams together
    maxStackedStreams: int(env, "MAX_STACKED_STREAMS", 2, 0, 8),
    logLevel: ["debug", "info", "warn", "error"].includes(logLevel) ? logLevel : "info",
    ffmpegPath: env.FFMPEG_PATH || "ffmpeg",
    ffprobePath: env.FFPROBE_PATH || "ffprobe",
  });
}
