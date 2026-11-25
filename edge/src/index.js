import fs from "node:fs";
import path from "node:path";
import { createApi } from "./api.js";
import { PreviewSender } from "./camera.js";
import { detectEncoder, makeClip } from "./clipper.js";
import {
  AGENT_VERSION,
  ConfigError,
  ENV_FILE,
  leftoverWarnings,
  loadConfig,
  loadEnvFile,
  USER_AGENT,
} from "./config.js";
import { CredentialsError, markRevoked, resolveCredentials } from "./credentials.js";
import { ffmpegMajorVersion } from "./ffmpeg.js";
import { makeGameFile } from "./game.js";
import { makePrivate, PRIVATE_UMASK, setupWarnings } from "./hardening.js";
import { sampleHealth } from "./health.js";
import { JobRunner } from "./jobs.js";
import { LiveView } from "./live.js";
import { createLogger, setLogLevel } from "./log.js";
import { gameKey, JobQueue } from "./queue.js";
import { RecorderManager } from "./recorder.js";
import { Restreams } from "./restream.js";
import { DeviceSync } from "./sync.js";
import { registerSecret } from "./util.js";
import { VideoStore } from "./videos.js";

/**
 * Dyna Cam recorder box: config sync + heartbeat, one recorder per court, and
 * the clip job loop. The API is reached over outbound HTTPS only; the one
 * listener (the live view) is for the venue LAN.
 */
/**
 * A person has to act (revoked box, refused or missing ENROLL_KEY / VENUE_ID):
 * say what to do, wait a minute, then exit non-zero. pm2's restart_delay is
 * only 5 s, so the pause keeps a stuck box from restarting in a tight loop.
 */
const EXIT_PAUSE_MS = 60_000;
function exitAfterPause(message, log) {
  log.error(message);
  return new Promise(() => {
    setTimeout(() => process.exit(1), EXIT_PAUSE_MS);
  });
}

function exitIfNoKey(err, log) {
  if (!(err instanceof CredentialsError)) throw err;
  return exitAfterPause(err.message, log);
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

/**
 * CR-044: `.env` and DATA_DIR private to this account (they hold the enrol key,
 * the token, camera passwords and players' videos), then say what else is unsafe.
 */
async function secureSetup(settings, log) {
  const { fixed, warnings } = await makePrivate([
    { path: ENV_FILE, mode: 0o600 },
    { path: settings.dataDir, mode: 0o700 },
  ]);
  for (const target of fixed) log.info(`made ${target} private to this account`);
  let procMounts = null;
  if (process.platform === "linux") {
    procMounts = await fs.promises.readFile("/proc/mounts", "utf8").catch(() => null);
  }
  const facts = {
    settings,
    platform: process.platform,
    uid: process.getuid?.() ?? null,
    procMounts,
  };
  for (const line of [...warnings, ...setupWarnings(facts)]) log.warn(`security: ${line}`);
}

/** The parts that talk to the API: previews, config/heartbeat sync and the job loop. */
function createServices({ settings, api, recorders, encoder, jobsDir, live, streams }) {
  // Camera-setup previews: lowest priority, never while clips are busy (jobs is set below)
  let jobs = null;
  const preview = new PreviewSender({
    api,
    courtDir: (courtId, camera) => recorders.courtDir(courtId, camera),
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
    streams,
  });
  const clipLog = createLogger("clip");
  const gameLog = createLogger("game");
  const queue = new JobQueue(path.join(settings.dataDir, "queue.json"));
  // CR-040: game videos kept on the box and sent from here to Google Drive
  const videos = new VideoStore({
    dir: path.join(settings.dataDir, "videos"),
    api,
    log: createLogger("videos"),
    isBusy: (id) => queue.has(gameKey(id)),
    diskCriticalMb: settings.diskCriticalMb,
  });
  sync.videos = videos;
  // CR-008: the box's own health in every heartbeat (disk, memory, clock, backlog)
  sync.health = (clockOffsetMs) =>
    sampleHealth({
      dataDir: settings.dataDir,
      queueEntries: () => queue.list(),
      videoStats: () => videos.stats(),
      clockOffsetMs,
    });
  jobs = new JobRunner({
    api,
    queue,
    videos,
    jobsDir,
    settings,
    log: createLogger("jobs"),
    clip: (entry, { workDir, signal }) =>
      makeClip(entry, {
        // Both cameras' folders: stacked when both have the window
        segmentsDirs: recorders.courtDirs(entry.courtId),
        courtKnown: sync.courtKnown(entry.courtId),
        workDir,
        logoPath: sync.logoPath,
        encoder,
        settings,
        signal,
        log: clipLog,
      }),
    // CR-006: one camera's whole game, copied (no logo, no re-encode)
    game: (entry, { workDir, signal, onCopy }) =>
      makeGameFile(entry, {
        segmentsDirs: recorders.courtDirs(entry.courtId),
        // A camera-2 job on a court without camera 2 fails at once
        courtCameras: sync.courtCameras(entry.courtId),
        workDir,
        settings,
        signal,
        onCopy,
        log: gameLog,
      }),
  });

  return { preview, sync, jobs, videos };
}

/**
 * LAN live view from the buffer (a taken port only turns it off, recording goes
 * on) and every live stream (venue court streams and players' own): their own
 * ffmpeg reading the live view — never the recorder.
 */
async function startLiveView(settings, recorders, encoder) {
  const live = new LiveView({ settings, log: createLogger("live") });
  await live.start();
  const streams = new Restreams({
    live,
    cameras: (courtId) => recorders.cameraInfo(courtId),
    ffmpegPath: settings.ffmpegPath,
    encoder,
    vaapiDevice: settings.vaapiDevice,
    maxStacked: settings.maxStackedStreams,
    log: createLogger("stream"),
  });
  process.on("exit", () => streams.killAllSync());
  return { live, streams };
}

async function main() {
  // CR-044: everything this process and its ffmpegs create is private to this account
  process.umask(PRIVATE_UMASK);
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
  // ENROLL_KEY has no recognisable shape: mask it in every log line from here on
  registerSecret(settings.enrollKey);
  for (const line of leftoverWarnings(settings)) log.warn(line);

  const ffmpegMajor = await checkFfmpeg(settings, log);

  const jobsDir = path.join(settings.dataDir, "jobs");
  for (const dir of [settings.dataDir, jobsDir, path.join(settings.dataDir, "buffer")]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  await secureSetup(settings, log);

  const encoder = await detectEncoder({
    ffmpegPath: settings.ffmpegPath,
    preferred: settings.encoder,
    vaapiDevice: settings.vaapiDevice,
    log: createLogger("encoder"),
  });
  log.info(`ffmpeg ${ffmpegMajor}.x, clip encoder: ${encoder}`);

  const api = createApi({ apiUrl: settings.apiUrl, userAgent: USER_AGENT });
  const enrollLog = createLogger("enroll");
  const credentialArgs = { settings, api, agentVersion: AGENT_VERSION, log: enrollLog };
  const creds = await resolveCredentials(credentialArgs).catch((err) =>
    exitIfNoKey(err, enrollLog)
  );
  api.setToken(creds.token);
  if (creds.device) {
    log.info(
      `recorder box ${creds.device.name || ""} (enrolled ${creds.device.enrolledAt || creds.device.pairedAt || "earlier"})`
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

  const { live, streams } = await startLiveView(settings, recorders, encoder);
  const services = { settings, api, recorders, encoder, jobsDir, live, streams };
  const { preview, sync, jobs, videos } = createServices(services);

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
    await streams.stopAll();
    live.close();
    await jobs.stop();
    await videos.stop();
    await recorders.stopAll();
  };

  // A 401: the box was revoked. Stop recording and job work, forget the token
  // and the cached config, write revoked.json (no automatic re-enrolment —
  // a person deletes it), then exit.
  api.onUnauthorized = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    stopWork()
      .then(() => markRevoked({ settings, device: creds.device }))
      .then((message) => exitAfterPause(message, enrollLog))
      .catch((err) => {
        log.error("could not record the revocation", err);
        process.exit(1);
      });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  recorders.startTicker();
  streams.startTicker();
  // Before the first /config: it tidies the kept videos
  await videos.load();
  await sync.init();
  if (shuttingDown) return;
  await jobs.start();
  videos.start();
  sync.startTimers();
}

main().catch((err) => {
  console.error(`fatal: ${err?.stack || err}`);
  process.exit(1);
});
