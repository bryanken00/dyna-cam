import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { backoffMs, sleep as defaultSleep, readJson, writeJsonAtomic } from "./util.js";

/**
 * How the box proves who it is (PLAN-002). In order:
 *
 *   1. DATA_DIR/device.json — the token from an earlier pairing (mode 0600)
 *   2. DEVICE_TOKEN in .env — the older way, copied from the Admin portal
 *   3. PAIRING_CODE in .env — a 6-digit key, redeemed ONCE with POST /pair/device;
 *      the token is saved to device.json and the key is not needed again
 *
 * A key that was used or refused is remembered (only its hash) in
 * pairing-used.json, so a restart never sends the same key again — wrong
 * keys count towards the API's pairing pause for everyone.
 *
 * The token and the key are never logged.
 */

export const DEVICE_FILE = "device.json";
export const USED_CODES_FILE = "pairing-used.json";
/** A key lives 10 minutes; past this, keep the box from retrying a dead key. */
export const PAIRING_GIVE_UP_MS = 15 * 60_000;

export const ADD_BOX_HINT =
  "Add the box in Admin → Setup → Recorder Boxes and put its 6-digit key in .env as PAIRING_CODE, then restart.";

/** A person must act (new key / config); the message says what to do. */
export class CredentialsError extends Error {}

const refused = (message) => Object.assign(new CredentialsError(message), { refused: true });

export const codeHash = (code) => crypto.createHash("sha256").update(String(code)).digest("hex");

export async function loadStoredDevice(dataDir) {
  const data = await readJson(path.join(dataDir, DEVICE_FILE), null);
  return typeof data?.token === "string" && data.token ? data : null;
}

/** Saved atomically with mode 0600: the token is the box's password. */
export const saveDevice = (dataDir, data) =>
  writeJsonAtomic(path.join(dataDir, DEVICE_FILE), data, 0o600);

export const forgetDevice = (dataDir) => fsp.rm(path.join(dataDir, DEVICE_FILE), { force: true });

export async function isCodeUsed(dataDir, code) {
  const used = await readJson(path.join(dataDir, USED_CODES_FILE), []);
  return Array.isArray(used) && used.includes(codeHash(code));
}

export async function markCodeUsed(dataDir, code) {
  const file = path.join(dataDir, USED_CODES_FILE);
  const used = await readJson(file, []);
  const list = Array.isArray(used) ? used : [];
  if (!list.includes(codeHash(code))) list.push(codeHash(code));
  await writeJsonAtomic(file, list.slice(-50), 0o600);
}

/**
 * Redeem a pairing key. Retries a 429 (after Retry-After, else 60 s) and
 * network/5xx errors (backoff) for up to 15 min; a 400 (wrong, expired or
 * used key) is final. → { token, device, venue }
 */
export async function redeemPairingCode({
  api,
  code,
  agentVersion,
  log,
  sleep = defaultSleep,
  now = () => Date.now(),
}) {
  const startedAt = now();
  for (let attempt = 1; ; attempt += 1) {
    try {
      const data = await api.pairDevice(code, agentVersion);
      if (typeof data?.token !== "string" || !data.token) throw new Error("no token in the answer");
      return data;
    } catch (err) {
      if (err.status === 400 || err.status === 422) {
        throw refused(
          "The pairing key was not accepted — it is wrong, expired (keys last 10 minutes) or already used. " +
            "Make a new one in Admin → Setup → Recorder Boxes, put it in .env as PAIRING_CODE and restart."
        );
      }
      const delay =
        err.status === 429 ? (err.retryAfterMs ?? 60_000) : backoffMs(attempt, 2000, 60_000);
      if (now() - startedAt + delay > PAIRING_GIVE_UP_MS) {
        throw new CredentialsError(
          `Could not pair with the API for 15 minutes (${err.message}). ${ADD_BOX_HINT}`
        );
      }
      log.warn(
        `pairing ${err.status === 429 ? "is paused by the API" : "failed"}, trying again in ${Math.round(delay / 1000)}s`,
        err.status === 429 ? undefined : err
      );
      await sleep(delay);
    }
  }
}

/** Redeem PAIRING_CODE, remember it as used either way, save the token. */
async function pair({ settings, api, agentVersion, log, sleep, now }) {
  const code = settings.pairingCode;
  let data;
  try {
    data = await redeemPairingCode({ api, code, agentVersion, log, sleep, now });
  } catch (err) {
    if (err.refused) {
      await markCodeUsed(settings.dataDir, code);
    }
    throw err;
  }
  await markCodeUsed(settings.dataDir, code);
  const stored = {
    token: data.token,
    deviceId: data.device?.deviceId ?? null,
    venueId: data.venue?.venueId ?? null,
    name: data.device?.name ?? null,
    venueName: data.venue?.name ?? null,
    pairedAt: new Date(now()).toISOString(),
  };
  await saveDevice(settings.dataDir, stored);
  log.info(
    `Paired as ${stored.name || "this box"} for ${stored.venueName || "the venue"} — you can remove PAIRING_CODE from .env`
  );
  return { token: stored.token, source: "paired", device: stored };
}

/** Is there a PAIRING_CODE that hasn't been used or refused yet? */
const freshCode = async (settings) =>
  Boolean(settings.pairingCode) && !(await isCodeUsed(settings.dataDir, settings.pairingCode));

/**
 * The token to use at start-up. → { token, source: "stored" | "env" | "paired", device? }
 * Throws CredentialsError when a person has to add or fix a key.
 */
export async function resolveCredentials({
  settings,
  api,
  agentVersion,
  log,
  sleep,
  now = () => Date.now(),
}) {
  const stored = await loadStoredDevice(settings.dataDir);
  if (stored) return { token: stored.token, source: "stored", device: stored };
  if (settings.deviceToken) return { token: settings.deviceToken, source: "env" };
  if (await freshCode(settings)) return pair({ settings, api, agentVersion, log, sleep, now });
  if (settings.pairingCode) {
    throw new CredentialsError(`The PAIRING_CODE in .env was already used. ${ADD_BOX_HINT}`);
  }
  throw new CredentialsError(`This box has no key yet. ${ADD_BOX_HINT}`);
}

/**
 * After a 401 on a stored/paired token: forget it, then try a NEW
 * PAIRING_CODE once (never one already used). → the new credentials.
 * Throws CredentialsError when there is no usable key.
 */
export async function recoverFromRevoked({
  settings,
  api,
  agentVersion,
  log,
  sleep,
  now = () => Date.now(),
}) {
  log.error("This box was revoked — add it again in Admin to get a new pairing key");
  await forgetDevice(settings.dataDir);
  // The cached config holds the venue's camera passwords — a revoked box keeps none
  await fsp.rm(path.join(settings.dataDir, "config.json"), { force: true });
  if (!(await freshCode(settings))) throw new CredentialsError(ADD_BOX_HINT);
  return pair({ settings, api, agentVersion, log, sleep, now });
}
