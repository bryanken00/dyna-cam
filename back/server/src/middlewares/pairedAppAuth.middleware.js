import { ERROR_CODES } from "../utils/APIError.js";
import { getCurrentTimestampLocal } from "../utils/dateUtils.js";
import { hashToken } from "../utils/crypto/tokens.js";
import { secondsAgoLocal } from "../utils/clips.js";

/**
 * Paired staff phone authentication for /api/v1/app/* (PLAN-002).
 *
 * The phone sends `Authorization: App <token>` — the token it got once when it
 * redeemed a 6-digit pairing key. Only an Active phone of a live venue gets
 * through; it is attached as `req.pairedApp` = { pairedAppId, venueId, name }.
 * Every route scopes its queries to `req.pairedApp.venueId`.
 *
 * A 401 with TOKEN_INVALID is the only answer the app treats as "unpaired";
 * anything else (network errors, 5xx) keeps the phone paired.
 */
export const requirePairedApp = async (req, res, next) => {
  try {
    const [scheme, token] = (req.get("authorization") || "").split(" ");
    if (scheme !== "App" || !token) {
      return res.status(401).json({
        success: false,
        message: "This phone is not paired",
        code: ERROR_CODES.TOKEN_INVALID,
      });
    }

    const rows = await req.db.query(
      `SELECT pa.pairedAppId, pa.venueId, pa.name, pa.lastSeenAt
       FROM paired_apps pa
       JOIN venues v ON v.venueId = pa.venueId AND v.status != 'Deleted'
       WHERE pa.tokenHash = ? AND pa.status = 'Active'
       LIMIT 1`,
      [hashToken(token)]
    );
    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "This phone was unpaired — ask for a new pairing key",
        code: ERROR_CODES.TOKEN_INVALID,
      });
    }

    const { lastSeenAt, ...pairedApp } = rows[0];
    req.pairedApp = pairedApp;

    // A sign of life, at most once a minute (phones poll the clip status often)
    if (!lastSeenAt || lastSeenAt < secondsAgoLocal(60)) {
      await req.db.query(`UPDATE paired_apps SET lastSeenAt = ? WHERE pairedAppId = ?`, [
        getCurrentTimestampLocal(),
        pairedApp.pairedAppId,
      ]);
    }
    next();
  } catch (err) {
    next(err);
  }
};

export default requirePairedApp;
