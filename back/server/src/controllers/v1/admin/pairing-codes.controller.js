import express from "express";
import { catchAsync, validateBody } from "../../../utils/catchAsync.js";
import { getCurrentTimestampLocal } from "../../../utils/dateUtils.js";
import { checkPermission } from "../../../middlewares/checkPermission.middleware.js";
import { noIdempotencyCache } from "../../../middlewares/idempotency.middleware.js";
import { createPairingCode, PAIRING_CODE_TTL_MINUTES } from "../../../utils/pairing.js";
import { createPairingCodeSchema } from "../../../validators/pairing.validator.js";

/**
 * Pairing keys (PLAN-002): a 6-digit, single-use, 10-minute key a staff phone
 * or recorder box redeems once at /api/v1/pair. Shown once, never stored in
 * clear, never in the idempotency cache.
 *
 *   /apps       staff phones   — permission paired_apps
 *   /recorders  recorder boxes — permission venues/devices
 *
 * Each kind has its own routes so each sits behind its own permission.
 */
const router = express.Router();

const KINDS = {
  apps: { kind: "APP", permission: ["paired_apps", null] },
  recorders: { kind: "RECORDER", permission: ["venues", "devices"] },
};

for (const [path, { kind, permission }] of Object.entries(KINDS)) {
  /**
   * GET /<kind> — keys still waiting to be used (without the digits)
   */
  router.get(
    `/${path}`,
    checkPermission(...permission, "read"),
    catchAsync(async (req, res) => {
      const rows = await req.db.query(
        `SELECT pc.pairingCodeId, pc.venueId, v.name AS venueName, pc.name, pc.expiresAt,
                pc.dateCreated
         FROM pairing_codes pc JOIN venues v ON v.venueId = pc.venueId
         WHERE pc.kind = ? AND pc.status = 'Active' AND pc.expiresAt > ?
         ORDER BY pc.dateCreated DESC`,
        [kind, getCurrentTimestampLocal()]
      );
      return res.sendSuccess("Pairing keys", { pairingCodes: rows });
    })
  );

  /**
   * POST /<kind> — create a key for a venue; the digits are shown only now
   */
  router.post(
    `/${path}`,
    checkPermission(...permission, "write"),
    validateBody(createPairingCodeSchema),
    catchAsync(async (req, res) => {
      const { venueId, name } = req.body;
      let conn;
      let created;
      try {
        conn = await req.db.beginTransaction();
        const [venue] = await conn.execute(
          `SELECT venueId FROM venues WHERE venueId = ? AND status != 'Deleted' LIMIT 1`,
          [venueId]
        );
        if (venue.length === 0) {
          await req.db.rollback(conn);
          return res.sendError("Venue not found", 400);
        }
        created = await createPairingCode(conn, {
          kind,
          venueId,
          name,
          accountId: req.user.accountId,
        });
        await req.db.commit(conn);
      } catch (err) {
        await req.db.rollback(conn);
        throw err;
      }

      noIdempotencyCache(res); // the key must never sit in the cache table
      return res.sendSuccess(
        `Pairing key created — it works once, for ${PAIRING_CODE_TTL_MINUTES} minutes`,
        created,
        201
      );
    })
  );

  /**
   * DELETE /<kind>/:pairingCodeId — cancel a key nobody has used yet
   */
  router.delete(
    `/${path}/:pairingCodeId`,
    checkPermission(...permission, "write"),
    catchAsync(async (req, res) => {
      const now = getCurrentTimestampLocal();
      const result = await req.db.query(
        `UPDATE pairing_codes SET status = 'Cancelled', dateUpdated = ?
         WHERE pairingCodeId = ? AND kind = ? AND status = 'Active'`,
        [now, req.params.pairingCodeId, kind]
      );
      if (result.affectedRows === 0) {
        return res.sendError("Pairing key not found", 404);
      }
      return res.sendSuccess("Pairing key cancelled");
    })
  );
}

export default router;
