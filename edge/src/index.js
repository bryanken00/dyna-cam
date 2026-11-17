import fs from "node:fs";
import path from "node:path";
import { createApi } from "./api.js";
import { startButtonServer } from "./buttons.js";
import { PreviewSender } from "./camera.js";
import { detectEncoder, makeClip } from "./clipper.js";
import { AGENT_VERSION, ConfigError, loadConfig, loadEnvFile, USER_AGENT } from "./config.js";
import { CredentialsError, recoverFromRevoked, resolveCredentials } from "./credentials.js";
import { ffmpegMajorVersion } from "./ffmpeg.js";
import { JobRunner } from "./jobs.js";
import { LiveView } from "./live.js";
import { createLogger, setLogLevel } from "./log.js";
import { JobQueue } from "./queue.js";
import { RecorderManager } from "./recorder.js";
import { DeviceSync } from "./sync.js";

/**
 * Dyna Cam recorder box: config sync + heartbeat, one recorder per court, and
 * the clip job loop. The API is reached over outbound HTTPS only; the two
 * listeners (court buttons, live view) are for the venue LAN.
 */
/** No usable key: say what to do and stop (a person has to act). */
function exitIfNoKey(err, log) {
  if (!(err instanceof CredentialsError)) throw err;
  log.error(err.message);
  process.exit(1);
}

/** ffmpeg's major version; exits with a clear message when ffmpeg is missing. */
async function checkFfmpeg(settings, log) {
  let major;
  try {
    major = await ffmpegMajorVersion(settings.ffmpegPath);
  } catch (err) {
    log.error(
      `ffmpeg not found at "${settings.ffmpegPath}" — install it (apt install ffmpeg) or set FFMPEG_PATH`,
      err
    );
    process.exit(1);
  }
  if (major < 5) log.warn(`ffmpeg ${major}.x is old — version 5 or newer is recommended`);
  return major;
}

/** The parts that talk to the API: previews, config/heartbeat sync and the job loop. */
function createServices({ settings, api, recorders, encoder, jobsDir, live }) {
  // Camera-setup previews: lowest priority, never while clips are busy (jobs is set below)
  let jobs = null;
  const preview = new PreviewSender({
    api,
    courtDir: (courtId) => recorders.courtDir(courtId),
    settings,
    isBusy: () => Boolean(jobs?.isBusy()),
    log: createLogger("preview"),
  });

  const sync = new DeviceSync({
    preview,
    api,
    recorders,
    settings,
    agentVersion: AGENT_VERSION,
    log: createLogger("sync"),
    live,
  });
  const clipLog = createLogger("clip");
  jobs = new JobRunner({
    api,
    queue: new JobQueue(path.join(settings.dataDir, "queue.json")),
    jobsDir,
    settings,
    log: createLogger("jobs"),
    clip: (entry, { workDir, signal }) =>
      makeClip(entry, {
        segmentsDir: recorders.courtDir(entry.courtId),
        courtKnown: sync.courtKnown(entry.courtId),
        workDir,
        logoPath: sync.logoPath,
        encoder,
        settings,
        signal,
        log: clipLog,
      }),
  });

  return { preview, sync, jobs };
}

async function main() {
  loadEnvFile();
  let settings;
  try {
    settings = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`[config] ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
  setLogLevel(settings.logLevel);
  const log = createLogger("main");
  log.info(`${USER_AGENT} starting — API ${settings.apiUrl}, data in ${settings.dataDir}`);
  if (settings.ignoredDeviceToken) {
    log.warn(
      "DEVICE_TOKEN in .env is no longer used — a box pairs with a 6-digit PAIRING_CODE " +
        "(Admin → Setup → Recorder Boxes → Add box). You can delete the DEVICE_TOKEN line."
    );
  }

  const ffmpegMajor = await checkFfmpeg(settings, log);

  const jobsDir = path.join(settings.dataDir, "jobs");
  for (const dir of [settings.dataDir, jobsDir, path.join(settings.dataDir, "buffer")]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const encoder = await detectEncoder({
    ffmpegPath: settings.ffmpegPath,
    preferred: settings.encoder,
    vaapiDevice: settings.vaapiDevice,
    log: createLogger("encoder"),
  });
  log.info(`ffmpeg ${ffmpegMajor}.x, clip encoder: ${encoder}`);

  const api = createApi({ apiUrl: settings.apiUrl, userAgent: USER_AGENT });
  const pairingLog = createLogger("pairing");
  const credentialArgs = { settings, api, agentVersion: AGENT_VERSION, log: pairingLog };
  const creds = await resolveCredentials(credentialArgs).catch((err) =>
    exitIfNoKey(err, pairingLog)
  );
  api.setToken(creds.token);
  if (creds.device) {
    log.info(
      `recorder box ${creds.device.name || ""} (paired ${creds.device.pairedAt || "earlier"})`
    );
  }
  const recorders = new RecorderManager({
    dataDir: settings.dataDir,
    settings,
    ffmpegMajor,
    log: createLogger("recorder"),
  });
  // Whatever happens to this process, no ffmpeg is left recording behind it
  process.on("exit", () => recorders.killAllSync());

  // LAN live view from the buffer; a taken port only turns it off, recording goes on
  const live = new LiveView({ settings, log: createLogger("live") });
  await live.start();

  const { preview, sync, jobs } = createServices({
    settings,
    api,
    recorders,
    encoder,
    jobsDir,
    live,
  });

  // Stream restarts wait until no uncut clip/part window reaches into the last 70 s
  recorders.pendingWindows = (courtId) => jobs.pendingWindows(courtId);

  let buttons = null;
  const previewTimer = setInterval(() => {
    preview.tick().catch((err) => log.warn("preview failed", err));
  }, 5000);
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) {
      log.warn(`${signal} again — exiting now`);
      process.exit(1);
    }
    shuttingDown = true;
    log.info(`${signal} received — stopping`);
    const force = setTimeout(() => {
      log.error("shutdown took too long — forcing exit");
      process.exit(1);
    }, 12_000);
    force.unref();
    await stopWork();
    log.info("stopped cleanly");
    process.exit(0);
  };
  const stopWork = async () => {
    sync.stop();
    clearInterval(previewTimer);
    buttons?.close();
    live.close();
    await jobs.stop();
    await recorders.stopAll();
  };

  // A 401: the box was revoked. Stop recording and job work, forget the token,
  // and try a NEW PAIRING_CODE once (pm2 restarts the process with the new
  // pairing).
  api.onUnauthorized = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    stopWork()
      .then(() => recoverFromRevoked(credentialArgs))
      .then(() => {
        log.info("paired again — restarting with the new key");
        process.exit(0);
      })
      .catch((err) => exitIfNoKey(err, pairingLog));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  recorders.startTicker();
  await sync.init();
  if (shuttingDown) return;
  await jobs.start();
  sync.startTimers();
  if (settings.buttonPort && !shuttingDown) {
    buttons = await startButtonServer({
      host: settings.buttonHost,
      port: settings.buttonPort,
      key: settings.buttonKey,
      log: createLogger("buttons"),
      onPress: (press) => jobs.addPress(press),
    });
  }
}

main().catch((err) => {
  console.error(`fatal: ${err?.stack || err}`);
  process.exit(1);
});
