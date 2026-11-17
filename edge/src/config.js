import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** edge/ — .env and the default DATA_DIR resolve from here, not from the cwd. */
export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "package.json"), "utf8"));
export const AGENT_VERSION = pkg.version;
// The API blocks requests with no User-Agent or one containing "bot"
export const USER_AGENT = `DynaCamRecorder/${pkg.version}`;

export const ENCODERS = ["auto", "libx264", "h264_qsv", "h264_vaapi", "h264_videotoolbox"];

export class ConfigError extends Error {}

/** Load edge/.env into process.env (real environment variables win). */
export function loadEnvFile(file = path.join(ROOT_DIR, ".env")) {
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

/** PAIRING_CODE as typed ("123 456", "123-456") → "123456"; empty → null. */
export function parsePairingCode(raw) {
  const code = String(raw ?? "").replace(/[\s-]/g, "");
  if (!code) return null;
  if (!/^\d{6}$/.test(code)) {
    throw new ConfigError(
      "PAIRING_CODE must be the 6-digit key from Admin → Setup → Recorder Boxes"
    );
  }
  return code;
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

/** Read and check the settings. Throws ConfigError with a message meant for a person. */
export function loadConfig(env = process.env) {
  const apiUrl = String(env.API_URL ?? "")
    .trim()
    .replace(/\/+$/, "");
  // Credentials (credentials.js): a token saved by pairing in DATA_DIR/device.json,
  // else DEVICE_TOKEN (the older way), else a 6-digit PAIRING_CODE to redeem
  const deviceToken = String(env.DEVICE_TOKEN ?? "").trim();
  const pairingCode = parsePairingCode(env.PAIRING_CODE);
  if (!apiUrl) {
    throw new ConfigError(
      "Missing API_URL. Copy .env.example to .env, set API_URL and the 6-digit PAIRING_CODE from " +
        "the Admin portal → Setup → Recorder Boxes."
    );
  }
  let parsed;
  try {
    parsed = new URL(apiUrl);
  } catch (_err) {
    throw new ConfigError(`API_URL is not a valid URL (got "${apiUrl}")`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new ConfigError("API_URL must start with https:// (or http:// for local testing)");
  }

  const encoder = String(env.ENCODER || "auto").trim();
  if (!ENCODERS.includes(encoder)) {
    throw new ConfigError(`ENCODER must be one of ${ENCODERS.join(", ")} (got "${encoder}")`);
  }
  const logLevel = String(env.LOG_LEVEL || "info").trim();
  // Live view on the LAN: unset → 8090; set to "" or 0 → off
  const buttonPort = env.BUTTON_PORT === undefined ? 8089 : int(env, "BUTTON_PORT", 0, 0, 65535);
  const livePort = env.LIVE_PORT === undefined ? 8090 : int(env, "LIVE_PORT", 0, 0, 65535);
  if (livePort && livePort === buttonPort) {
    throw new ConfigError(`LIVE_PORT and BUTTON_PORT must differ (both are ${livePort})`);
  }
  const liveHost = parseLiveHost(env.LIVE_HOST);

  return Object.freeze({
    apiUrl,
    deviceToken,
    pairingCode,
    dataDir: path.resolve(ROOT_DIR, env.DATA_DIR || "./data"),
    segmentSeconds: int(env, "SEGMENT_SECONDS", 2, 1, 10),
    // A clip needs 65 s plus the time the job takes to reach the box
    bufferSeconds: int(env, "BUFFER_SECONDS", 180, 90, 3600),
    encoder,
    vaapiDevice: env.VAAPI_DEVICE || "/dev/dri/renderD128",
    recordAudio: bool(env, "RECORD_AUDIO", true),
    clipConcurrency: int(env, "CLIP_CONCURRENCY", 1, 1, 4),
    uploadConcurrency: int(env, "UPLOAD_CONCURRENCY", 1, 1, 4),
    heartbeatSeconds: int(env, "HEARTBEAT_SECONDS", 30, 5, 600),
    configRefreshSeconds: int(env, "CONFIG_REFRESH_SECONDS", 60, 10, 3600),
    // Free space in DATA_DIR: warn below, stop keeping session footage below critical
    diskWarnGb: int(env, "DISK_WARN_GB", 2, 0, 10_000),
    diskCriticalMb: int(env, "DISK_CRITICAL_MB", 500, 0, 1_000_000),
    // Court buttons on the LAN: unset → 8089; set to "" or 0 → off
    buttonPort,
    buttonHost: String(env.BUTTON_HOST || "0.0.0.0").trim(),
    buttonKey: String(env.BUTTON_KEY ?? "").trim(),
    livePort,
    liveHost,
    logLevel: ["debug", "info", "warn", "error"].includes(logLevel) ? logLevel : "info",
    ffmpegPath: env.FFMPEG_PATH || "ffmpeg",
    ffprobePath: env.FFPROBE_PATH || "ffprobe",
  });
}
