import express from "express";

import { noIdempotencyCache } from "../../../middlewares/idempotency.middleware.js";
import { catchAsync, validateBody, validateParams, validateQuery } from "../../../utils/catchAsync.js";
import { temporaryPassword } from "../../../utils/companies.js";
import { getCurrentTimestampLocal } from "../../../utils/dateUtils.js";
import { hashPassword } from "../../../utils/hashing/argonHash.js";
import { recordPlatformAudit } from "../../../utils/platformAudit.js";
import {
  createAdminSchema,
  listAdminsQuerySchema,
  platformAdminIdParamsSchema,
  updateAdminSchema,
} from "../../../validators/backoffice.validator.js";

/**
 * PLAN-008 phase E: the back office's own people — super admins. Any active super
 * admin manages the others (there are no back-office roles). A new one, or one whose
 * password is reset, gets a temporary password shown once in the reply (never stored
 * for replay) and must change it at first sign-in. Rules:
 *   - you can't deactivate (or reset) yourself — use Your account for your password;
 *   - the last Active super admin can't be deactivated (409);
 *   - a deactivated admin's sessions end and their token stops at the next request
 *     (requirePlatformAdmin reads the status every time);
 *   - an unknown or Deleted admin → 404.
 * Every change is written to the back office's audit trail.
 */
const router = express.Router();

const adminView = (a, selfId) => ({
  platformAdminId: a.platformAdminId,
  firstName: a.firstName,
  lastName: a.lastName,
  email: a.email,
  status: a.status,
  mustChangePassword: Boolean(a.mustChangePassword),
  lastSignInAt: a.lastSignInAt || null,
  isSelf: a.platformAdminId === selfId,
  dateCreated: a.dateCreated,
});

const ADMIN_COLUMNS = `a.platformAdminId, a.firstName, a.lastName, a.email, a.status, a.mustChangePassword,
  a.dateCreated,
  (SELECT MAX(t.dateCreated) FROM platform_audit_trail t
   WHERE t.platformAdminId = a.platformAdminId AND t.action = 'LOGIN') AS lastSignInAt`;

/** The admin (not Deleted) or null. */
const findAdmin = async (db, platformAdminId) => {
  const rows = await db.query(
    `SELECT ${ADMIN_COLUMNS} FROM platform_admins a
     WHERE a.platformAdminId = ? AND a.status != 'Deleted' LIMIT 1`,
    [platformAdminId]
  );
  return rows[0] || null;
};

const endSessions = (db, platformAdminId, now) =>
  db.query(
    `UPDATE platform_admin_refresh_tokens SET revokedAt = ?, dateUpdated = ?
     WHERE platformAdminId = ? AND revokedAt IS NULL`,
    [now, now, platformAdminId]
  );

const fullName = (a) => `${a.firstName} ${a.lastName}`;

/** GET / — every super admin (not Deleted), Active first, then by name. */
router.get(
  "/",
  validateQuery(listAdminsQuerySchema),
  catchAsync(async (req, res) => {
    const { status } = req.query;
    const rows = await req.db.query(
      `SELECT ${ADMIN_COLUMNS} FROM platform_admins a
       WHERE a.status != 'Deleted' ${status ? "AND a.status = ?" : ""}
       ORDER BY a.status = 'Active' DESC, a.firstName, a.lastName`,
      status ? [status] : []
    );
    return res.sendSuccess("Super admins retrieved successfully", {
      admins: rows.map((a) => adminView(a, req.platformAdmin.platformAdminId)),
    });
  })
);

/** POST / — add a super admin; the reply carries their temporary password once. */
router.post(
  "/",
  validateBody(createAdminSchema),
  catchAsync(async (req, res) => {
    const { firstName, lastName, email } = req.body;
    // platform_admins.email is unique across every row, Deleted too
    const taken = await req.db.query(`SELECT 1 FROM platform_admins WHERE email = ? LIMIT 1`, [email]);
    if (taken.length > 0) return res.sendError("That email already has a back-office account", 409);

    const password = temporaryPassword(email);
    const now = getCurrentTimestampLocal();
    const [{ platformAdminId }] = await req.db.query(`SELECT UUID() AS platformAdminId`);
    try {
      await req.db.query(
        `INSERT INTO platform_admins
           (platformAdminId, firstName, lastName, email, password, status, mustChangePassword, dateCreated, dateUpdated)
         VALUES (?, ?, ?, ?, ?, 'Active', 1, ?, ?)`,
        [platformAdminId, firstName, lastName, email, await hashPassword(password), now, now]
      );
    } catch (err) {
      if (err.code === "ER_DUP_ENTRY") return res.sendError("That email already has a back-office account", 409);
      throw err;
    }

    await recordPlatformAudit(req, {
      action: "ADMIN_CREATE",
      description: `Added super admin ${firstName} ${lastName} (${email})`,
      metadata: { platformAdminId, email },
    });
    noIdempotencyCache(res);
    return res.sendSuccess(
      "Super admin added",
      { platformAdminId, email, temporaryPassword: password },
      201
    );
  })
);

/** PATCH /:platformAdminId — first and last name. */
router.patch(
  "/:platformAdminId",
  validateParams(platformAdminIdParamsSchema),
  validateBody(updateAdminSchema),
  catchAsync(async (req, res) => {
    const admin = await findAdmin(req.db, req.params.platformAdminId);
    if (!admin) return res.sendError("Super admin not found", 404);
    const { firstName, lastName } = req.body;
    await req.db.query(
      `UPDATE platform_admins SET firstName = ?, lastName = ?, dateUpdated = ?
       WHERE platformAdminId = ? AND status != 'Deleted'`,
      [firstName, lastName, getCurrentTimestampLocal(), admin.platformAdminId]
    );
    if (firstName !== admin.firstName || lastName !== admin.lastName) {
      await recordPlatformAudit(req, {
        action: "ADMIN_UPDATE",
        description: `Renamed super admin ${fullName(admin)} to ${firstName} ${lastName}`,
        metadata: {
          platformAdminId: admin.platformAdminId,
          before: { firstName: admin.firstName, lastName: admin.lastName },
          after: { firstName, lastName },
        },
      });
    }
    return res.sendSuccess("Super admin updated", {
      admin: adminView(await findAdmin(req.db, admin.platformAdminId), req.platformAdmin.platformAdminId),
    });
  })
);

/**
 * POST /:platformAdminId/deactivate — they can't sign in; their sessions end now.
 * Not yourself, and never the last Active one (checked under a lock, so two
 * deactivations at once can't both pass).
 */
router.post(
  "/:platformAdminId/deactivate",
  validateParams(platformAdminIdParamsSchema),
  catchAsync(async (req, res) => {
    const { platformAdminId } = req.params;
    if (platformAdminId === req.platformAdmin.platformAdminId) {
      return res.sendError("You can't deactivate yourself", 409);
    }

    let conn;
    let admin;
    const now = getCurrentTimestampLocal();
    try {
      conn = await req.db.beginTransaction();
      const [active] = await conn.execute(
        `SELECT platformAdminId FROM platform_admins WHERE status = 'Active' FOR UPDATE`
      );
      const [rows] = await conn.execute(
        `SELECT platformAdminId, firstName, lastName, email, status FROM platform_admins
         WHERE platformAdminId = ? AND status != 'Deleted' LIMIT 1 FOR UPDATE`,
        [platformAdminId]
      );
      admin = rows[0];
      if (!admin) {
        await req.db.rollback(conn);
        return res.sendError("Super admin not found", 404);
      }
      if (admin.status === "Active" && active.length <= 1) {
        await req.db.rollback(conn);
        return res.sendError("This is the last active super admin — add another before deactivating it", 409);
      }
      if (admin.status === "Active") {
        await conn.execute(
          `UPDATE platform_admins SET status = 'Inactive', dateUpdated = ? WHERE platformAdminId = ?`,
          [now, platformAdminId]
        );
        await conn.execute(
          `UPDATE platform_admin_refresh_tokens SET revokedAt = ?, dateUpdated = ?
           WHERE platformAdminId = ? AND revokedAt IS NULL`,
          [now, now, platformAdminId]
        );
      }
      await req.db.commit(conn);
    } catch (err) {
      if (conn) await req.db.rollback(conn);
      throw err;
    }

    if (admin.status === "Active") {
      await recordPlatformAudit(req, {
        action: "ADMIN_DEACTIVATE",
        description: `Deactivated super admin ${fullName(admin)} (${admin.email})`,
        metadata: { platformAdminId },
      });
    }
    return res.sendSuccess("Super admin deactivated", {
      admin: adminView(await findAdmin(req.db, platformAdminId), req.platformAdmin.platformAdminId),
    });
  })
);

/** POST /:platformAdminId/reactivate — back to Active. */
router.post(
  "/:platformAdminId/reactivate",
  validateParams(platformAdminIdParamsSchema),
  catchAsync(async (req, res) => {
    const admin = await findAdmin(req.db, req.params.platformAdminId);
    if (!admin) return res.sendError("Super admin not found", 404);
    const result = await req.db.query(
      `UPDATE platform_admins SET status = 'Active', failedLoginAttempts = 0, lockedUntil = NULL, dateUpdated = ?
       WHERE platformAdminId = ? AND status = 'Inactive'`,
      [getCurrentTimestampLocal(), admin.platformAdminId]
    );
    if (result.affectedRows > 0) {
      await recordPlatformAudit(req, {
        action: "ADMIN_REACTIVATE",
        description: `Reactivated super admin ${fullName(admin)} (${admin.email})`,
        metadata: { platformAdminId: admin.platformAdminId },
      });
    }
    return res.sendSuccess("Super admin reactivated", {
      admin: adminView(await findAdmin(req.db, admin.platformAdminId), req.platformAdmin.platformAdminId),
    });
  })
);

/**
 * POST /:platformAdminId/reset-password — a new temporary password (shown once); they
 * must change it at next sign-in, their sessions end and a lockout is cleared.
 */
router.post(
  "/:platformAdminId/reset-password",
  validateParams(platformAdminIdParamsSchema),
  catchAsync(async (req, res) => {
    if (req.params.platformAdminId === req.platformAdmin.platformAdminId) {
      return res.sendError("Change your own password in Your account", 409);
    }
    const admin = await findAdmin(req.db, req.params.platformAdminId);
    if (!admin) return res.sendError("Super admin not found", 404);

    const password = temporaryPassword(admin.email);
    const now = getCurrentTimestampLocal();
    await req.db.query(
      `UPDATE platform_admins
       SET password = ?, mustChangePassword = 1, failedLoginAttempts = 0, lockedUntil = NULL, dateUpdated = ?
       WHERE platformAdminId = ?`,
      [await hashPassword(password), now, admin.platformAdminId]
    );
    await endSessions(req.db, admin.platformAdminId, now);

    await recordPlatformAudit(req, {
      action: "ADMIN_PASSWORD_RESET",
      description: `Reset the password of super admin ${fullName(admin)} (${admin.email})`,
      metadata: { platformAdminId: admin.platformAdminId },
    });
    noIdempotencyCache(res);
    return res.sendSuccess("Password reset", { email: admin.email, temporaryPassword: password });
  })
);

export default router;
