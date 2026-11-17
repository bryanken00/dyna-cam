import express from "express";
import { catchAsync, validateBody } from "../../../utils/catchAsync.js";
import { getCurrentTimestampLocal } from "../../../utils/dateUtils.js";
import { ERROR_CODES } from "../../../utils/APIError.js";
import { logger } from "../../../../config/logger.js";
import { dynamicLimiter } from "../../../middlewares/rateLimiter.js";
import { noIdempotencyCache } from "../../../middlewares/idempotency.middleware.js";
import { hashToken, randomToken } from "../../../utils/crypto/tokens.js";
import { findLivePairingCode, markPairingCodeUsed } from "../../../utils/pairing.js";
import { pairAppSchema, pairDeviceSchema } from "../../../validators/pairing.validator.js";

/**
 * Pairing (PLAN-002) — mounted at /api/v1/pair with NO login: the 6-digit key
 * is the credential, once.
 *
 *   POST /app      a staff phone redeems an APP key      → its token (shown once)
 *   POST /device   a recorder box redeems a RECORDER key → its token (shown once)
 *
 * Guessing: a key is single-use and lives 10 minutes; each IP gets
 * RATE_LIMIT_PAIR_POINTS tries per minute and RATE_LIMIT_PAIR_HOURLY_POINTS per
 * hour, and once PAIR_MAX_FAILURES wrong keys arrive within 10 minutes (from
 * anywhere) all pairing pauses until the window passes.
 */
const router = express.Router();

const perMinute = dynamicLimiter({
  points: parseInt(process.env.RATE_LIMIT_PAIR_POINTS || "5", 10),
  duration: 60,
  keyGenerator: (req) => `pair-min:${req.ip}`,
  message: "Too many pairing attempts — wait a minute and try again.",
});
const perHour = dynamicLimiter({
  points: parseInt(process.env.RATE_LIMIT_PAIR_HOURLY_POINTS || "20", 10),
  duration: 3600,
  keyGenerator: (req) => `pair-hour:${req.ip}`,
  message: "Too many pairing attempts from this network — try again later.",
});

// Global cap on wrong keys (per process — the API runs as one process)
const FAILURE_WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = parseInt(process.env.PAIR_MAX_FAILURES || "100", 10);
let failures = [];
const recentFailures = () => {
  const since = Date.now() - FAILURE_WINDOW_MS;
  failures = failures.filter((at) => at > since);
  return failures.length;
};
const pairingPaused = (req, res, next) => {
  if (recentFailures() >= MAX_FAILURES) {
    return res.sendError(
      "Pairing is paused for a few minutes after too many wrong keys. Try again shortly.",
      null,
      429,
      ERROR_CODES.RATE_LIMIT_EXCEEDED
    );
  }
  next();
};
const wrongKey = (req, res, kind) => {
  failures.push(Date.now());
  logger.warn("Pairing: wrong or expired key", { kind, ip: req.ip });
  return res.sendError(
    "That pairing key is wrong or has expired. Ask for a new one in the Admin portal.",
    null,
    400,
    ERROR_CODES.INVALID_INPUT
  );
};

/**
 * POST /app — pair a staff phone
 */
router.post(
  "/app",
  pairingPaused,
  perMinute,
  perHour,
  validateBody(pairAppSchema),
  catchAsync(async (req, res) => {
    const { code, platform, appVersion } = req.body;
    const now = getCurrentTimestampLocal();

    let conn;
    let result = null;
    try {
      conn = await req.db.beginTransaction();
      const key = await findLivePairingCode(conn, { code, kind: "APP" });
      if (!key) {
        await req.db.rollback(conn);
      } else {
        const [uuidRow] = await conn.execute(`SELECT UUID() as id`);
        const pairedAppId = uuidRow[0].id;
        const token = `dca_${randomToken(32)}`;
        await conn.execute(
          `INSERT INTO paired_apps
             (pairedAppId, venueId, name, tokenHash, platform, appVersion, lastSeenAt, status,
              dateCreated, dateUpdated)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?)`,
          [
            pairedAppId,
            key.venueId,
            key.name,
            hashToken(token),
            platform || null,
            appVersion || null,
            now,
            now,
            now,
          ]
        );
        await markPairingCodeUsed(conn, key.pairingCodeId, pairedAppId);
        await req.db.commit(conn);
        result = { token, key, pairedAppId };
      }
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }

    if (!result) return wrongKey(req, res, "APP");

    noIdempotencyCache(res); // the token must never sit in the cache table
    return res.sendSuccess(
      "This phone is paired",
      {
        token: result.token,
        pairedApp: { pairedAppId: result.pairedAppId, name: result.key.name },
        venue: { venueId: result.key.venueId, name: result.key.venueName },
      },
      201
    );
  })
);

/**
 * POST /device — pair a recorder box (replaces copying DEVICE_TOKEN by hand)
 */
router.post(
  "/device",
  pairingPaused,
  perMinute,
  perHour,
  validateBody(pairDeviceSchema),
  catchAsync(async (req, res) => {
    const { code, agentVersion } = req.body;
    const now = getCurrentTimestampLocal();

    let conn;
    let result = null;
    try {
      conn = await req.db.beginTransaction();
      const key = await findLivePairingCode(conn, { code, kind: "RECORDER" });
      if (!key) {
        await req.db.rollback(conn);
      } else {
        const [uuidRow] = await conn.execute(`SELECT UUID() as id`);
        const deviceId = uuidRow[0].id;
        const token = `dcb_${randomToken(32)}`;
        await conn.execute(
          `INSERT INTO devices
             (deviceId, venueId, name, tokenHash, lastSeenAt, agentVersion, status, dateCreated,
              dateUpdated)
           VALUES (?, ?, ?, ?, ?, ?, 'Active', ?, ?)`,
          [deviceId, key.venueId, key.name, hashToken(token), now, agentVersion || null, now, now]
        );
        await markPairingCodeUsed(conn, key.pairingCodeId, deviceId);
        await req.db.commit(conn);
        result = { token, key, deviceId };
      }
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }

    if (!result) return wrongKey(req, res, "RECORDER");

    noIdempotencyCache(res);
    return res.sendSuccess(
      "This recorder box is paired",
      {
        token: result.token,
        device: { deviceId: result.deviceId, name: result.key.name },
        venue: { venueId: result.key.venueId, name: result.key.venueName },
      },
      201
    );
  })
);

/** For tests: forget the global failure count. */
export const resetPairingFailures = () => {
  failures = [];
};

export default router;
