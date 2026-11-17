import fs from "node:fs";
import path from "node:path";
import { createApi } from "./api.js";
import { detectEncoder, makeClip } from "./clipper.js";
import { AGENT_VERSION, ConfigError, loadConfig, loadEnvFile, USER_AGENT } from "./config.js";
import { ffmpegMajorVersion } from "./ffmpeg.js";
import { JobRunner } from "./jobs.js";
import { createLogger, setLogLevel } from "./log.js";
import { JobQueue } from "./queue.js";
import { RecorderManager } from "./recorder.js";
import { DeviceSync } from "./sync.js";

/**
 * Dyna Cam recorder box: config sync + heartbeat, one recorder per court, and
 * the clip job loop. Only outbound HTTPS — the venue needs no open ports.
 */
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

  let ffmpegMajor;
  try {
    ffmpegMajor = await ffmpegMajorVersion(settings.ffmpegPath);
  } catch (err) {
    log.error(
      `ffmpeg not found at "${settings.ffmpegPath}" — install it (apt install ffmpeg) or set FFMPEG_PATH`,
      err
    );
    process.exit(1);
  }
  if (ffmpegMajor < 5)
    log.warn(`ffmpeg ${ffmpegMajor}.x is old — version 5 or newer is recommended`);

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

  const api = createApi({
    apiUrl: settings.apiUrl,
    deviceToken: settings.deviceToken,
    userAgent: USER_AGENT,
  });
  const recorders = new RecorderManager({
    dataDir: settings.dataDir,
    settings,
    ffmpegMajor,
    log: createLogger("recorder"),
  });
  // Whatever happens to this process, no ffmpeg is left recording behind it
  process.on("exit", () => recorders.killAllSync());

  const sync = new DeviceSync({
    api,
    recorders,
    settings,
    agentVersion: AGENT_VERSION,
    log: createLogger("sync"),
  });
  const clipLog = createLogger("clip");
  const jobs = new JobRunner({
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
    sync.stop();
    await jobs.stop();
    await recorders.stopAll();
    log.info("stopped cleanly");
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  recorders.startTicker();
  await sync.init();
  if (shuttingDown) return;
  await jobs.start();
  sync.startTimers();
}

main().catch((err) => {
  console.error(`fatal: ${err?.stack || err}`);
  process.exit(1);
});
