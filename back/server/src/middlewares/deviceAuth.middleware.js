import { ERROR_CODES } from "../utils/APIError.js";
import { getCurrentTimestampLocal } from "../utils/dateUtils.js";
import { hashToken } from "../utils/crypto/tokens.js";

/**
 * Recorder-box authentication for /api/v1/device/*.
 *
 * A box sends `Authorization: Device <token>` — the token the Admin portal
 * showed once when the box was added. Only an Active box of a live venue gets
 * through; it is attached as `req.device` = { deviceId, venueId, name }.
 * Every authenticated request also counts as a sign of life (lastSeenAt).
 *
 * The device can only ever act on its own venue: every device route scopes its
 * queries to `req.device.venueId`.
 */
export const requireDevice = async (req, res, next) => {
  try {
    const header = req.get("authorization") || "";
    const [scheme, token] = header.split(" ");
    if (scheme !== "Device" || !token) {
      return res.status(401).json({
        success: false,
        message: "Recorder box token required",
        code: ERROR_CODES.TOKEN_INVALID,
      });
    }

    const rows = await req.db.query(
      `SELECT d.deviceId, d.venueId, d.name
       FROM devices d
       JOIN venues v ON v.venueId = d.venueId AND v.status != 'Deleted'
       WHERE d.tokenHash = ? AND d.status = 'Active'
       LIMIT 1`,
      [hashToken(token)]
    );
    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "This recorder box is not registered or has been revoked",
        code: ERROR_CODES.TOKEN_INVALID,
      });
    }

    req.device = rows[0];
    await req.db.query(`UPDATE devices SET lastSeenAt = ? WHERE deviceId = ?`, [
      getCurrentTimestampLocal(),
      req.device.deviceId,
    ]);
    next();
  } catch (err) {
    next(err);
  }
};

export default requireDevice;
