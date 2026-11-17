import fsp from "node:fs/promises";
import path from "node:path";
import { probeVideo } from "./ffmpeg.js";
import { backoffMs, readJson, sleep, writeJsonAtomic } from "./util.js";

const CLOCK_SKEW_WARN_MS = 2000;

/**
 * Keeps the box in step with the API: GET /config (courts → recorders, venue
 * logo → watermark) and POST /heartbeat (per-camera status).
 *
 * The last good config is cached in DATA_DIR/config.json (mode 600 — it holds
 * the camera passwords) so a box that reboots while the internet is down
 * still records.
 */
export class DeviceSync {
  constructor({
    api,
    recorders,
    settings,
    agentVersion,
    log,
    preview = null,
    live = null,
    sessionStreams = null,
  }) {
    this.preview = preview;
    // Players' own live streams (restream.js): fed with /config sessions, reported in the heartbeat
    this.sessionStreams = sessionStreams;
    // LAN live view (live.js): its address and signing key go in every heartbeat
    this.live = live;
    this.api = api;
    this.recorders = recorders;
    this.settings = settings;
    this.agentVersion = agentVersion;
    this.log = log;
    this.cacheFile = path.join(settings.dataDir, "config.json");
    this.logoDir = path.join(settings.dataDir, "logo");
    this.config = null;
    this.logo = { key: null, path: null };
    this.timers = [];
    this.abort = new AbortController();
  }

  /** Path of the current watermark image, or null (no logo / not downloaded). */
  get logoPath() {
    return this.logo.path;
  }

  courtKnown(courtId) {
    return Boolean(this.config?.courts?.some((c) => c.courtId === courtId));
  }

  /** First config: from the API, else from the cache, else keep trying. */
  async init() {
    try {
      await this.refresh();
      return;
    } catch (err) {
      this.log.warn("could not load config from the API", err);
    }
    const cached = await readJson(this.cacheFile, null);
    if (cached?.courts) {
      this.log.warn(`using the cached config from ${cached.savedAt} until the API is reachable`);
      await this.apply(cached, { fromCache: true });
      return;
    }
    for (let attempt = 1; !this.abort.signal.aborted; attempt += 1) {
      const delay = backoffMs(attempt, 5000, 60_000);
      this.log.warn(`no config yet — retrying in ${Math.round(delay / 1000)}s`);
      await sleep(delay, this.abort.signal);
      try {
        await this.refresh();
        return;
      } catch (err) {
        this.log.warn("config fetch failed", err);
      }
    }
  }

  async refresh() {
    const sentAt = Date.now();
    const config = await this.api.getConfig(this.abort.signal);
    const receivedAt = Date.now();
    this.checkClock(config.serverTime, sentAt, receivedAt);
    await this.apply(config);
    await writeJsonAtomic(this.cacheFile, {
      savedAt: new Date().toISOString(),
      device: config.device,
      venue: { ...config.venue, logoUrl: null },
      courts: config.courts,
      // Without the players' stream addresses: they hold stream keys and are only
      // used while the API is reachable
      sessions: (config.sessions || []).map(({ stream: _stream, ...session }) => session),
      clip: config.clip,
    });
  }

  async apply(config, { fromCache = false } = {}) {
    const first = !this.config;
    this.config = config;
    if (first) {
      this.log.info(
        `${config.device?.name || "recorder box"} for ${config.venue?.name || "venue"}: ${config.courts.length} court(s) with a camera`
      );
    }
    this.recorders.setSessions(config.sessions || []);
    await this.recorders.sync(config.courts || []);
    this.sessionStreams?.setSessions(fromCache ? [] : config.sessions || []);
    this.preview?.setWanted(fromCache ? [] : config.courts);
    if (!fromCache) await this.updateLogo(config.venue?.logoUrl ?? null);
  }

  /** Clips are matched to the camera by wall clock — a drifting box cuts the wrong moment. */
  checkClock(serverTime, sentAt, receivedAt) {
    if (!Number.isFinite(serverTime)) return;
    const skew = serverTime - (sentAt + receivedAt) / 2;
    if (Math.abs(skew) > CLOCK_SKEW_WARN_MS + (receivedAt - sentAt) / 2) {
      this.log.warn(
        `box clock is ${(skew / 1000).toFixed(1)}s ${skew > 0 ? "behind" : "ahead of"} the server — clips will be cut at the wrong moment. Check NTP (chronyc tracking).`
      );
    }
  }

  /**
   * The signed logo link changes on every /config (it expires), so the file is
   * re-downloaded only when the underlying path changes. A file ffmpeg cannot
   * read is ignored rather than breaking every clip.
   */
  async updateLogo(logoUrl) {
    if (!logoUrl) {
      if (this.logo.path) this.log.info("venue has no logo — clips will have no watermark");
      this.logo = { key: null, path: null };
      return;
    }
    const key = new URL(logoUrl, "http://x").pathname;
    if (key === this.logo.key && this.logo.path) return;
    const ext = (path.extname(key) || ".img").toLowerCase();
    const dest = path.join(this.logoDir, `logo${ext}`);
    try {
      await fsp.rm(this.logoDir, { recursive: true, force: true });
      await this.api.downloadFile(logoUrl, dest);
      await probeVideo(this.settings.ffprobePath, dest);
      this.logo = { key, path: dest };
      this.log.info("venue logo downloaded for the watermark");
    } catch (err) {
      this.logo = { key: null, path: null };
      this.log.warn("could not use the venue logo — clips will have no watermark for now", err);
    }
  }

  async heartbeat() {
    await this.api.heartbeat({
      agentVersion: this.agentVersion,
      cameras: this.recorders.statuses(),
      // { url, key } | null (off, port taken, or no LAN address)
      live: this.live?.info() ?? null,
      // [{ sessionId, status, message }] for each player stream due now; [] when none
      sessionStreams: this.sessionStreams?.statuses() ?? [],
    });
  }

  /**
   * While a camera-setup page is open or a player's stream is due, config and
   * heartbeat run every 15 s so starts, stops and statuses show up fast.
   */
  interval(seconds) {
    const busy = this.preview?.active || this.sessionStreams?.recordingNow();
    return busy ? Math.min(seconds, 15) : seconds;
  }

  startTimers() {
    const every = (seconds, label, fn) => {
      const run = async () => {
        try {
          await fn();
        } catch (err) {
          if (!this.abort.signal.aborted) this.log.warn(`${label} failed`, err);
        }
        if (!this.abort.signal.aborted) {
          this.timers.push(setTimeout(run, this.interval(seconds) * 1000));
        }
      };
      this.timers.push(
        setTimeout(run, label === "heartbeat" ? 2000 : this.interval(seconds) * 1000)
      );
    };
    every(this.settings.heartbeatSeconds, "heartbeat", () => this.heartbeat());
    every(this.settings.configRefreshSeconds, "config refresh", () => this.refresh());
  }

  stop() {
    this.abort.abort();
    for (const timer of this.timers) clearTimeout(timer);
  }
}
