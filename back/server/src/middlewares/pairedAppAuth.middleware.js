import { ERROR_CODES } from "../utils/APIError.js";
import { getCurrentTimestampLocal } from "../utils/dateUtils.js";
import { hashToken } from "../utils/crypto/tokens.js";
import { secondsAgoLocal } from "../utils/clips.js";
import { deviceExpired } from "../utils/sessionDevices.js";

/**
 * Session device authentication for /api/v1/app/* (PLAN-002 Phase E).
 *
 * The device sends `Authorization: App <token>` — the token it got once when it
 * redeemed a session's 6-digit pairing key. It works while its session is to
 * come or recording, and for SESSION_DEVICE_GRACE_MINUTES after it ends (to
 * keep showing the download QR). After that, when staff cancel the session or
 * unpair the device, the device is revoked and gets 401 TOKEN_INVALID.
 *
 * `req.pairedApp` = { pairedAppId, venueId, sessionId, name }. Every route is
 * scoped to `req.pairedApp.sessionId`.
 *
 * A 401 with TOKEN_INVALID is the only answer the app treats as "unpaired";
 * anything else (network errors, 5xx) keeps the device paired.
 */
const unpaired = (res, message) =>
  res.status(401).json({ success: false, message, code: ERROR_CODES.TOKEN_INVALID });

export const requirePairedApp = async (req, res, next) => {
  try {
    const [scheme, token] = (req.get("authorization") || "").split(" ");
    if (scheme !== "App" || !token) {
      return unpaired(res, "This device is not paired");
    }

    const rows = await req.db.query(
      `SELECT pa.pairedAppId, pa.venueId, pa.sessionId, pa.name, pa.lastSeenAt,
              s.status AS sessionStatus, s.endAt AS sessionEndAt
       FROM paired_apps pa
       JOIN venues v ON v.venueId = pa.venueId AND v.status != 'Deleted'
       JOIN recording_sessions s ON s.sessionId = pa.sessionId
       WHERE pa.tokenHash = ? AND pa.status = 'Active'
       LIMIT 1`,
      [hashToken(token)]
    );
    if (rows.length === 0) {
      return unpaired(res, "This device was unpaired — ask for a new pairing key");
    }

    const { lastSeenAt, sessionStatus, sessionEndAt, ...pairedApp } = rows[0];
    const now = getCurrentTimestampLocal();
    if (deviceExpired({ status: sessionStatus, endAt: sessionEndAt })) {
      await req.db.query(
        `UPDATE paired_apps SET status = 'Revoked', dateUpdated = ?
         WHERE pairedAppId = ? AND status = 'Active'`,
        [now, pairedApp.pairedAppId]
      );
      return unpaired(res, "The session has ended — this device is unpaired");
    }

    req.pairedApp = pairedApp;

    // A sign of life, at most once a minute (devices poll the session often)
    if (!lastSeenAt || lastSeenAt < secondsAgoLocal(60)) {
      await req.db.query(`UPDATE paired_apps SET lastSeenAt = ? WHERE pairedAppId = ?`, [
        now,
        pairedApp.pairedAppId,
      ]);
    }
    next();
  } catch (err) {
    next(err);
  }
};

export default requirePairedApp;
