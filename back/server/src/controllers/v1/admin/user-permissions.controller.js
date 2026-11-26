import express from "express";
import { catchAsync, validateBody } from "../../../utils/catchAsync.js";
import { getCurrentTimestampLocal } from "../../../utils/dateUtils.js";
import { checkPermission } from "../../../middlewares/checkPermission.middleware.js";
import { callerCompany } from "../../../utils/companyScope.js";
import {
  setUserPermissionSchema,
  bulkUserPermissionsSchema,
} from "../../../validators/user-permissions.validator.js";

const router = express.Router();

// The target account must be a live user of the caller's company (PLAN-008); Owner
// accounts are out of reach from the Admin portal. Params: [accountId, companyId]
const MANAGEABLE_USER_SQL = `SELECT u.accountId, u.roleId, r.roleName
   FROM users u
   LEFT JOIN roles r ON r.roleId = u.roleId
   WHERE u.accountId = ? AND u.companyId = ? AND u.status != 'Deleted' AND r.roleName != 'Owner'
   LIMIT 1`;

/**
 * GET /:accountId
 * Get user permissions (role-based + user overrides)
 */
router.get(
  "/:accountId",
  checkPermission("users", "list", "read"),
  catchAsync(async (req, res) => {
    const { accountId } = req.params;

    // Get user's role info
    const userRows = await req.db.query(MANAGEABLE_USER_SQL, [accountId, callerCompany(req)]);

    if (userRows.length === 0) {
      return res.sendError("User not found", 404);
    }

    const { roleId, roleName } = userRows[0];

    // Role permissions and user-specific overrides are independent — fetch in parallel.
    const [rolePermissions, userPermissions] = await Promise.all([
      req.db.query(
        `SELECT
        rp.id,
        rp.permissionId,
        rp.accessLevel,
        p.module,
        p.submodule,
        p.description,
        'role' as source
      FROM role_permissions rp
      INNER JOIN permissions p ON p.permissionId = rp.permissionId
      WHERE rp.roleId = ? AND p.status = 'Active'`,
        [roleId]
      ),
      req.db.query(
        `SELECT
        up.userPermissionId,
        up.permissionId,
        up.accessLevel,
        p.module,
        p.submodule,
        p.description,
        'user' as source
      FROM user_permissions up
      INNER JOIN permissions p ON p.permissionId = up.permissionId
      WHERE up.accountId = ? AND p.status = 'Active'`,
        [accountId]
      ),
    ]);

    return res.sendSuccess("User permissions retrieved", {
      roleId,
      roleName,
      rolePermissions,
      userPermissions,
    });
  })
);

/**
 * POST /:accountId
 * Set a single user permission override
 * Body: { permissionId, accessLevel }
 */
router.post(
  "/:accountId",
  checkPermission("users", "list", "write"),
  validateBody(setUserPermissionSchema),
  catchAsync(async (req, res) => {
    const { accountId } = req.params;
    const { permissionId, accessLevel } = req.body;
    const now = getCurrentTimestampLocal();

    let conn;
    try {
      conn = await req.db.beginTransaction();

      const [userRows] = await conn.execute(MANAGEABLE_USER_SQL, [accountId, callerCompany(req)]);

      if (userRows.length === 0) {
        await req.db.rollback(conn);
        return res.sendError("User not found", 404);
      }

      // Generate UUID from MySQL
      const [uuidRow] = await conn.execute(`SELECT UUID() as id`);
      const userPermissionId = uuidRow[0].id;

      // Check if override already exists for this permission
      const [existing] = await conn.execute(
        `SELECT userPermissionId FROM user_permissions
         WHERE accountId = ? AND permissionId = ?
         LIMIT 1 FOR UPDATE`,
        [accountId, permissionId]
      );

      if (existing.length > 0) {
        // Update existing override
        await conn.execute(
          `UPDATE user_permissions SET accessLevel = ? WHERE accountId = ? AND permissionId = ?`,
          [accessLevel, accountId, permissionId]
        );
        await req.db.commit(conn);
        return res.sendSuccess("Permission override updated", {
          userPermissionId: existing[0].userPermissionId,
        });
      }

      // Insert new override
      await conn.execute(
        `INSERT INTO user_permissions (userPermissionId, accountId, permissionId, accessLevel, dateCreated)
         VALUES (?, ?, ?, ?, ?)`,
        [userPermissionId, accountId, permissionId, accessLevel, now]
      );

      await req.db.commit(conn);

      return res.sendSuccess("Permission override added", { userPermissionId }, 201);
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }
  })
);

/**
 * DELETE /:accountId/:permissionId
 * Remove a user permission override
 */
router.delete(
  "/:accountId/:permissionId",
  checkPermission("users", "list", "write"),
  catchAsync(async (req, res) => {
    const { accountId, permissionId } = req.params;

    const userRows = await req.db.query(MANAGEABLE_USER_SQL, [accountId, callerCompany(req)]);

    if (userRows.length === 0) {
      return res.sendError("User not found", 404);
    }

    const result = await req.db.query(
      `DELETE FROM user_permissions WHERE userPermissionId = ? AND accountId = ?`,
      [permissionId, accountId]
    );

    if (result.affectedRows === 0) {
      return res.sendError("Permission override not found", 404);
    }

    return res.sendSuccess("Permission override removed");
  })
);

/**
 * POST /:accountId/bulk
 * Bulk update user permissions (replace all overrides)
 * Body: { permissions: [{ permissionId, accessLevel }, ...] }
 */
router.post(
  "/:accountId/bulk",
  checkPermission("users", "list", "write"),
  validateBody(bulkUserPermissionsSchema),
  catchAsync(async (req, res) => {
    const { accountId } = req.params;
    const { permissions } = req.body;
    const now = getCurrentTimestampLocal();

    let conn;
    try {
      conn = await req.db.beginTransaction();

      const [userRows] = await conn.execute(MANAGEABLE_USER_SQL, [accountId, callerCompany(req)]);

      if (userRows.length === 0) {
        await req.db.rollback(conn);
        return res.sendError("User not found", 404);
      }

      // Remove all existing overrides for this user
      await conn.execute(`DELETE FROM user_permissions WHERE accountId = ?`, [accountId]);

      // Insert new overrides in a single bulk statement. UUID() is generated
      // inline per row, removing the per-row `SELECT UUID()` round-trip.
      if (permissions && permissions.length > 0) {
        const placeholders = permissions
          .map(() => "(UUID(), ?, ?, ?, ?)")
          .join(", ");
        const values = permissions.flatMap((perm) => [
          accountId,
          perm.permissionId,
          perm.accessLevel,
          now,
        ]);
        await conn.execute(
          `INSERT INTO user_permissions (userPermissionId, accountId, permissionId, accessLevel, dateCreated)
           VALUES ${placeholders}`,
          values
        );
      }

      await req.db.commit(conn);

      return res.sendSuccess("Permissions updated successfully");
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }
  })
);

export default router;
