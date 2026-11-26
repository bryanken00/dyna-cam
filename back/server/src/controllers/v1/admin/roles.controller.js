import express from "express";
import { catchAsync, validateBody, validateQuery } from "../../../utils/catchAsync.js";
import { getCurrentTimestampLocal } from "../../../utils/dateUtils.js";
import { checkPermission } from "../../../middlewares/checkPermission.middleware.js";
import { callerCompany } from "../../../utils/companyScope.js";
import {
  createRoleSchema,
  updateRoleSchema,
  assignPermissionsSchema,
  listRolesQuerySchema,
} from "../../../validators/roles.validator.js";

const router = express.Router();

/**
 * GET /
 * List all roles (the Owner role is never listed)
 */
router.get(
  "/",
  checkPermission("users", "roles", "read"),
  validateQuery(listRolesQuerySchema),
  catchAsync(async (req, res) => {
    const {
      page = 1,
      pageSize = 10,
      search = "",
      status,
      sortBy = "dateCreated",
      sortOrder = "DESC",
    } = req.query;
    const offset = (page - 1) * pageSize;
    // PLAN-008: only the caller's company's roles
    const params = [callerCompany(req)];
    let whereClause = "WHERE r.companyId = ? AND r.status != 'Deleted' AND r.roleName != 'Owner'";

    if (search) {
      whereClause += ` AND (r.roleName LIKE ? OR r.description LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }

    if (status) {
      whereClause += ` AND r.status = ?`;
      params.push(status);
    }

    const allowedSortColumns = ["dateCreated", "dateUpdated", "roleName"];
    const safeSortBy = allowedSortColumns.includes(sortBy) ? sortBy : "dateCreated";
    const safeSortOrder = sortOrder.toUpperCase() === "ASC" ? "ASC" : "DESC";

    const [countRows, roles] = await Promise.all([
      req.db.query(
        `SELECT COUNT(*) as total FROM roles r ${whereClause}`,
        params
      ),
      req.db.query(
        `SELECT
        r.roleId,
        r.roleName,
        r.description,
        r.status,
        r.dateCreated,
        r.dateUpdated
      FROM roles r
      ${whereClause}
      ORDER BY r.${safeSortBy} ${safeSortOrder}
      LIMIT ? OFFSET ?`,
        [...params, Number(pageSize), Number(offset)]
      ),
    ]);
    const total = countRows[0]?.total || 0;

    return res.sendSuccess("Roles retrieved successfully", {
      roles,
      pagination: {
        page: Number(page),
        pageSize: Number(pageSize),
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  })
);

/**
 * GET /:roleId
 * Get single role
 */
router.get(
  "/:roleId",
  checkPermission("users", "roles", "read"),
  catchAsync(async (req, res) => {
    const { roleId } = req.params;
    const roles = await req.db.query(
      `SELECT roleId, roleName, description, status, dateCreated, dateUpdated
       FROM roles
       WHERE roleId = ? AND companyId = ? AND status != 'Deleted' AND roleName != 'Owner'
       LIMIT 1`,
      [roleId, callerCompany(req)]
    );

    if (roles.length === 0) {
      return res.sendError("Role not found", 404);
    }

    return res.sendSuccess("Role retrieved successfully", { role: roles[0] });
  })
);

/**
 * POST /
 * Create new role
 */
router.post(
  "/",
  checkPermission("users", "roles", "write"),
  validateBody(createRoleSchema),
  catchAsync(async (req, res) => {
    const { roleName, description } = req.body;
    const now = getCurrentTimestampLocal();

    let conn;
    try {
      conn = await req.db.beginTransaction();

      // Generate UUID from MySQL
      const [uuidRow] = await conn.execute(`SELECT UUID() as id`);
      const roleId = uuidRow[0].id;

      // Check duplicate roleName within the company (PLAN-008: names are unique per
      // company; this also keeps a second "Owner" from being made)
      const [existing] = await conn.execute(
        `SELECT roleId FROM roles
         WHERE companyId = ? AND roleName = ? AND status != 'Deleted'
         LIMIT 1 FOR UPDATE`,
        [callerCompany(req), roleName]
      );

      if (existing.length > 0) {
        await req.db.rollback(conn);
        return res.sendError("A role with this name already exists", 409);
      }

      await conn.execute(
        `INSERT INTO roles (roleId, companyId, roleName, description, status, dateCreated, dateUpdated)
         VALUES (?, ?, ?, ?, 'Active', ?, ?)`,
        [roleId, callerCompany(req), roleName, description || null, now, now]
      );

      await req.db.commit(conn);

      return res.sendSuccess("Role created successfully", { roleId }, 201);
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }
  })
);

/**
 * PUT /:roleId
 * Update role
 */
router.put(
  "/:roleId",
  checkPermission("users", "roles", "write"),
  validateBody(updateRoleSchema),
  catchAsync(async (req, res) => {
    const { roleId } = req.params;
    const { roleName, description, status } = req.body;
    const now = getCurrentTimestampLocal();

    let conn;
    try {
      conn = await req.db.beginTransaction();

      // Another role already has this name (this also keeps a role from being
      // renamed to "Owner")
      const [existing] = await conn.execute(
        `SELECT roleId FROM roles
         WHERE companyId = ? AND roleName = ? AND roleId != ? AND status != 'Deleted'
         LIMIT 1 FOR UPDATE`,
        [callerCompany(req), roleName, roleId]
      );

      if (existing.length > 0) {
        await req.db.rollback(conn);
        return res.sendError("A role with this name already exists", 409);
      }

      const [result] = await conn.execute(
        `UPDATE roles
         SET roleName = ?, description = ?, status = ?, dateUpdated = ?
         WHERE roleId = ? AND companyId = ? AND status != 'Deleted' AND roleName != 'Owner'`,
        [roleName, description || null, status || "Active", now, roleId, callerCompany(req)]
      );

      if (result.affectedRows === 0) {
        await req.db.rollback(conn);
        return res.sendError("Role not found", 404);
      }

      await req.db.commit(conn);

      return res.sendSuccess("Role updated successfully");
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }
  })
);

/**
 * DELETE /:roleId
 * Soft delete role (status → Inactive since roles only have Active/Inactive)
 */
router.delete(
  "/:roleId",
  checkPermission("users", "roles", "write"),
  catchAsync(async (req, res) => {
    const { roleId } = req.params;
    const now = getCurrentTimestampLocal();

    const result = await req.db.query(
      `UPDATE roles SET status = 'Inactive', dateUpdated = ?
       WHERE roleId = ? AND companyId = ? AND status = 'Active' AND roleName != 'Owner'`,
      [now, roleId, callerCompany(req)]
    );

    if (result.affectedRows === 0) {
      return res.sendError("Role not found", 404);
    }

    return res.sendSuccess("Role deleted successfully");
  })
);

/**
 * GET /:roleId/permissions
 * Get permissions assigned to a role
 */
router.get(
  "/:roleId/permissions",
  checkPermission("users", "roles", "read"),
  catchAsync(async (req, res) => {
    const { roleId } = req.params;

    // Joining roles keeps the Owner role (and another company's roles) from resolving
    // to any rows.
    const permissions = await req.db.query(
      `SELECT
        rp.id,
        rp.roleId,
        rp.permissionId,
        rp.accessLevel,
        rp.dateCreated,
        p.module,
        p.submodule,
        p.description
      FROM role_permissions rp
      INNER JOIN roles r ON r.roleId = rp.roleId
      INNER JOIN permissions p ON p.permissionId = rp.permissionId
      WHERE rp.roleId = ? AND r.companyId = ? AND r.roleName != 'Owner'`,
      [roleId, callerCompany(req)]
    );

    return res.sendSuccess("Role permissions retrieved", { permissions });
  })
);

/**
 * POST /:roleId/permissions
 * Assign permissions to a role (replaces existing)
 * Body: { permissions: ["permissionId1", "permissionId2", ...] }
 */
router.post(
  "/:roleId/permissions",
  checkPermission("users", "roles", "write"),
  validateBody(assignPermissionsSchema),
  catchAsync(async (req, res) => {
    const { roleId } = req.params;
    const { permissions } = req.body;
    const now = getCurrentTimestampLocal();

    let conn;
    try {
      conn = await req.db.beginTransaction();

      // The role must exist (and never be Owner) before its permission set
      // is replaced
      const [roleRows] = await conn.execute(
        `SELECT roleId FROM roles
         WHERE roleId = ? AND companyId = ? AND status != 'Deleted' AND roleName != 'Owner'
         LIMIT 1 FOR UPDATE`,
        [roleId, callerCompany(req)]
      );

      if (roleRows.length === 0) {
        await req.db.rollback(conn);
        return res.sendError("Role not found", 404);
      }

      // Remove existing permissions for this role
      await conn.execute(`DELETE FROM role_permissions WHERE roleId = ?`, [roleId]);

      // Insert new permissions in a single bulk statement.
      // Each perm must be { permissionId, accessLevel }.
      if (permissions && permissions.length > 0) {
        const placeholders = permissions.map(() => "(?, ?, ?, ?)").join(", ");
        const values = permissions.flatMap((perm) => [
          roleId,
          perm.permissionId,
          perm.accessLevel,
          now,
        ]);
        await conn.execute(
          `INSERT INTO role_permissions (roleId, permissionId, accessLevel, dateCreated)
           VALUES ${placeholders}`,
          values
        );
      }

      await req.db.commit(conn);

      return res.sendSuccess("Permissions assigned successfully");
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }
  })
);

export default router;
