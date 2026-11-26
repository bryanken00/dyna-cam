import express from "express";
import { openGameEnd } from "../../../utils/sessions.js";
import { catchAsync, validateBody } from "../../../utils/catchAsync.js";
import { getCurrentTimestampLocal } from "../../../utils/dateUtils.js";
import { ERROR_CODES } from "../../../utils/APIError.js";
import { logger } from "../../../../config/logger.js";
import { dynamicLimiter } from "../../../middlewares/rateLimiter.js";
import { noIdempotencyCache } from "../../../middlewares/idempotency.middleware.js";
import { hashToken, randomToken } from "../../../utils/crypto/tokens.js";
import { findLivePairingCode, markPairingCodeUsed } from "../../../utils/pairing.js";
import { loadDeviceSession, toDeviceSession } from "../../../utils/sessionDevices.js";
import { enrollDeviceSchema, pairAppSchema } from "../../../validators/pairing.validator.js";

/**
 * Pairing (PLAN-002) — mounted at /api/v1/pair with NO login: the 6-digit key
 * is the credential, once.
 *
 *   POST /app      a session device redeems a session key → its token (shown once)
 *   POST /enroll   a recorder box enrols with its company's enroll key → its token
 *                  (Phase I; PLAN-008 phase F: the key is per company, from the back office)
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
 * POST /app — pair a phone/tablet to the session its key belongs to (Phase E)
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
             (pairedAppId, venueId, sessionId, name, tokenHash, platform, appVersion, lastSeenAt,
              status, dateCreated, dateUpdated)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?)`,
          [
            pairedAppId,
            key.venueId,
            key.sessionId,
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
        // CR-005: the first device on a waiting game starts the recording now.
        // Later devices find it Recording and change nothing.
        await conn.execute(
          `UPDATE recording_sessions
           SET status = 'Recording', startAt = ?, endAt = ?, dateUpdated = ?
           WHERE sessionId = ? AND status = 'Waiting'`,
          [now, openGameEnd(), now, key.sessionId]
        );
        await req.db.commit(conn);
        result = { token, key, pairedAppId };
      }
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }

    if (!result) return wrongKey(req, res, "APP");

    noIdempotencyCache(res); // the token must never sit in the cache table
    const session = await loadDeviceSession(req.db, result.key.sessionId);
    return res.sendSuccess(
      "This device is paired to the session",
      {
        token: result.token,
        device: { pairedAppId: result.pairedAppId, name: result.key.name },
        session: toDeviceSession(session),
      },
      201
    );
  })
);

/**
 * POST /enroll — a recorder box set up from its .env (PLAN-002 Phase I):
 * { enrollKey, venueId, name?, agentVersion? } → its own token, once.
 * The key never travels again; the box keeps the token in DATA_DIR/device.json.
 *
 * PLAN-008 phase F: the key is a company's (back office → company → Generate enroll
 * key; stored only as its SHA-256). It's found by that hash among Active companies,
 * and the venue must be an Active venue of THAT company. Any other case — no such
 * key, a turned-off or regenerated one, a suspended company, another company's venue,
 * an unknown venue — gets the same refusal, so the reply never tells which part was
 * wrong. The per-IP limits and the global failure pause stay.
 */
router.post(
  "/enroll",
  pairingPaused,
  perMinute,
  perHour,
  validateBody(enrollDeviceSchema),
  catchAsync(async (req, res) => {
    const { enrollKey, venueId, name, agentVersion } = req.body;

    const now = getCurrentTimestampLocal();
    let conn;
    let result = null;
    try {
      conn = await req.db.beginTransaction();
      // One lookup by the key's hash: the venue, only if it's an Active venue of the
      // Active company that key belongs to
      const [venues] = await conn.execute(
        `SELECT v.venueId, v.name
         FROM companies co
         INNER JOIN venues v ON v.companyId = co.companyId AND v.venueId = ? AND v.status = 'Active'
         WHERE co.enrollKeyHash = ? AND co.status = 'Active'
         LIMIT 1`,
        [venueId, hashToken(enrollKey)]
      );
      if (venues.length === 0) {
        await req.db.rollback(conn);
      } else {
        const [uuidRow] = await conn.execute(`SELECT UUID() as id`);
        const deviceId = uuidRow[0].id;
        const token = `dcb_${randomToken(32)}`;
        const boxName = name || "Recorder box";
        await conn.execute(
          `INSERT INTO devices
             (deviceId, venueId, name, tokenHash, lastSeenAt, agentVersion, status, dateCreated,
              dateUpdated)
           VALUES (?, ?, ?, ?, ?, ?, 'Active', ?, ?)`,
          [deviceId, venueId, boxName, hashToken(token), now, agentVersion || null, now, now]
        );
        await req.db.commit(conn);
        result = { token, deviceId, name: boxName, venue: venues[0] };
      }
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }

    if (!result) {
      failures.push(Date.now());
      logger.warn("Recorder box enrolment refused", { ip: req.ip });
      return res.sendError(
        "That enrol key or venue isn't accepted",
        null,
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    noIdempotencyCache(res); // the token must never sit in the cache table
    logger.info("Recorder box enrolled", { deviceId: result.deviceId, venueId });
    return res.sendSuccess(
      "This recorder box is enrolled",
      {
        token: result.token,
        device: { deviceId: result.deviceId, name: result.name },
        venue: { venueId: result.venue.venueId, name: result.venue.name },
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
