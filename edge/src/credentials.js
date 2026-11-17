import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { backoffMs, sleep as defaultSleep, readJson, writeJsonAtomic } from "./util.js";

/**
 * How the box proves who it is (PLAN-002 Phase I — boxes are set up from
 * .env only):
 *
 *   1. DATA_DIR/device.json — the token from an earlier enrolment (mode 0600)
 *   2. ENROLL_KEY + VENUE_ID (+ BOX_NAME) in .env — enrol ONCE with
 *      POST /pair/enroll; the token is saved to device.json and the key is
 *      never sent again
 *
 * A key + venue the API refused (400) is remembered as a hash in
 * enroll-refused.json, so a restart doesn't send the same wrong values again
 * (they count towards the API's pause for everyone); changing either in .env
 * tries again.
 *
 * A revoked box (401) writes DATA_DIR/revoked.json and never enrols again by
 * itself: a person deletes that file. The token and the key are never logged.
 */

export const DEVICE_FILE = "device.json";
export const REVOKED_FILE = "revoked.json";
export const REFUSED_FILE = "enroll-refused.json";
/** Enrolment turned off on the API (403), or no answer: try again this often at most. */
export const ENROLL_RETRY_MAX_MS = 5 * 60_000;

/** A person must act (fix .env, delete revoked.json); the message says what to do. */
export class CredentialsError extends Error {}

export const revokedMessage = (dataDir) =>
  `This box was revoked — delete ${path.join(dataDir, REVOKED_FILE)} (and check .env) to enrol it again`;

/** Hash of the values that were refused (never the key itself on disk). */
export const enrollHash = (enrollKey, venueId) =>
  crypto.createHash("sha256").update(`${venueId}\n${enrollKey}`).digest("hex");

export async function loadStoredDevice(dataDir) {
  const data = await readJson(path.join(dataDir, DEVICE_FILE), null);
  return typeof data?.token === "string" && data.token ? data : null;
}

/** Saved atomically with mode 0600: the token is the box's password. */
export const saveDevice = (dataDir, data) =>
  writeJsonAtomic(path.join(dataDir, DEVICE_FILE), data, 0o600);

export const forgetDevice = (dataDir) => fsp.rm(path.join(dataDir, DEVICE_FILE), { force: true });

export const loadRevoked = (dataDir) => readJson(path.join(dataDir, REVOKED_FILE), null);

export async function isRefused(dataDir, enrollKey, venueId) {
  const refused = await readJson(path.join(dataDir, REFUSED_FILE), []);
  return Array.isArray(refused) && refused.includes(enrollHash(enrollKey, venueId));
}

export async function markRefused(dataDir, enrollKey, venueId) {
  const file = path.join(dataDir, REFUSED_FILE);
  const refused = await readJson(file, []);
  const list = Array.isArray(refused) ? refused : [];
  const hash = enrollHash(enrollKey, venueId);
  if (!list.includes(hash)) list.push(hash);
  await writeJsonAtomic(file, list.slice(-20), 0o600);
}

const REFUSED_HINT =
  "Check that ENROLL_KEY is exactly the API's RECORDER_ENROLL_KEY and VENUE_ID is the venue's ID " +
  "(Admin → Setup → Venues → the venue → Copy ID), then restart.";

/**
 * POST /pair/enroll until it answers. 400/422 (wrong key or venue) is final;
 * 403 (enrolment off on the API) and 404 (an API without enrolment) retry
 * every 5 min; 429 waits Retry-After (else 60 s); network/5xx back off
 * 2 s → 5 min. → { token, device, venue }
 */
export async function enroll({ settings, api, agentVersion, log, sleep = defaultSleep }) {
  const { enrollKey, venueId, boxName } = settings;
  for (let attempt = 1; ; attempt += 1) {
    try {
      const data = await api.enroll({ enrollKey, venueId, name: boxName, agentVersion });
      if (typeof data?.token !== "string" || !data.token) throw new Error("no token in the answer");
      return data;
    } catch (err) {
      if (err.status === 400 || err.status === 422) {
        await markRefused(settings.dataDir, enrollKey, venueId);
        throw new CredentialsError(
          `The API refused this box's ENROLL_KEY / VENUE_ID ("${err.detail || "not accepted"}"). ${REFUSED_HINT}`
        );
      }
      let delay;
      if (err.status === 403) {
        delay = ENROLL_RETRY_MAX_MS;
        log.error(
          "Enrolment is turned off on the API (RECORDER_ENROLL_KEY is not set there) — trying again in 5 min"
        );
      } else if (err.status === 404) {
        delay = ENROLL_RETRY_MAX_MS;
        log.error("The API has no enrolment (404) — update the API; trying again in 5 min");
      } else if (err.status === 429) {
        delay = err.retryAfterMs ?? 60_000;
        log.warn(`enrolling is paused by the API, trying again in ${Math.round(delay / 1000)}s`);
      } else {
        delay = backoffMs(attempt, 2000, ENROLL_RETRY_MAX_MS);
        log.warn(`enrolling failed, trying again in ${Math.round(delay / 1000)}s`, err);
      }
      await sleep(delay);
    }
  }
}

/** Enrol with .env, save the token. → { token, source: "enrolled", device } */
async function enrollAndSave({ settings, api, agentVersion, log, sleep, now }) {
  log.info(
    `enrolling this box as "${settings.boxName || "recorder box"}" for venue ${settings.venueId}`
  );
  const data = await enroll({ settings, api, agentVersion, log, sleep });
  const stored = {
    token: data.token,
    deviceId: data.device?.deviceId ?? null,
    venueId: data.venue?.venueId ?? null,
    name: data.device?.name ?? null,
    venueName: data.venue?.name ?? null,
    enrolledAt: new Date(now()).toISOString(),
  };
  await saveDevice(settings.dataDir, stored);
  log.info(`Enrolled as ${stored.name || "this box"} for ${stored.venueName || "the venue"}`);
  return { token: stored.token, source: "enrolled", device: stored };
}

/**
 * The token to use at start-up. → { token, source: "stored" | "enrolled", device }
 * Throws CredentialsError when a person has to act: the box was revoked
 * (`revoked: true`), or .env has values the API already refused / none at all.
 */
export async function resolveCredentials({
  settings,
  api,
  agentVersion,
  log,
  sleep,
  now = () => Date.now(),
}) {
  if (await loadRevoked(settings.dataDir)) {
    throw Object.assign(new CredentialsError(revokedMessage(settings.dataDir)), { revoked: true });
  }
  const stored = await loadStoredDevice(settings.dataDir);
  if (stored) return { token: stored.token, source: "stored", device: stored };
  if (!settings.enrollKey || !settings.venueId) {
    throw new CredentialsError(
      "This box isn't enrolled: set ENROLL_KEY and VENUE_ID in .env, then restart."
    );
  }
  if (await isRefused(settings.dataDir, settings.enrollKey, settings.venueId)) {
    throw new CredentialsError(
      `The API already refused this ENROLL_KEY / VENUE_ID — not sending them again. ${REFUSED_HINT}`
    );
  }
  return enrollAndSave({ settings, api, agentVersion, log, sleep, now });
}

/**
 * After a 401 on the stored token: forget it and the cached config (it holds
 * the venue's camera passwords), and write revoked.json so the box doesn't
 * enrol again by itself. → the message to log.
 */
export async function markRevoked({ settings, device = null, now = () => Date.now() }) {
  await forgetDevice(settings.dataDir);
  await fsp.rm(path.join(settings.dataDir, "config.json"), { force: true });
  await writeJsonAtomic(
    path.join(settings.dataDir, REVOKED_FILE),
    {
      revokedAt: new Date(now()).toISOString(),
      deviceId: device?.deviceId ?? null,
      name: device?.name ?? null,
    },
    0o600
  );
  return revokedMessage(settings.dataDir);
}
