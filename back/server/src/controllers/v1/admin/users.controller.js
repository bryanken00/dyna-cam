import express from "express";
import { catchAsync, validateBody, validateQuery } from "../../../utils/catchAsync.js";
import { getCurrentTimestampLocal } from "../../../utils/dateUtils.js";
import { signUploadUrl } from "../../../utils/file/signedUrl.js";
import { hashPassword } from "../../../utils/hashing/argonHash.js";
import { passwordProblem } from "../../../utils/passwordPolicy.js";
import { checkPermission } from "../../../middlewares/checkPermission.middleware.js";
import {
  createUserSchema,
  updateUserSchema,
  listUsersQuerySchema,
} from "../../../validators/admin-users.validator.js";

const router = express.Router();

// A role the Admin portal may assign: any live role except Owner.
// Params: [roleId]
const ASSIGNABLE_ROLE_SQL = `SELECT roleId FROM roles
   WHERE roleId = ? AND status != 'Deleted' AND roleName != 'Owner'
   LIMIT 1`;

/**
 * GET /
 * List all users with pagination and filtering (the Owner is never listed)
 */
router.get(
  "/",
  checkPermission("users", "list", "read"),
  validateQuery(listUsersQuerySchema),
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
    const params = [];
    let whereClause = "WHERE u.status != 'Deleted' AND r.roleName != 'Owner'";

    if (search) {
      whereClause += ` AND (u.firstName LIKE ? OR u.lastName LIKE ? OR c.email LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (status) {
      whereClause += ` AND u.status = ?`;
      params.push(status);
    }

    // Whitelist sort inputs before interpolating into SQL
    const allowedSortColumns = ["dateCreated", "dateUpdated", "firstName", "lastName"];
    const safeSortBy = allowedSortColumns.includes(sortBy) ? sortBy : "dateCreated";
    const safeSortOrder = sortOrder.toUpperCase() === "ASC" ? "ASC" : "DESC";

    // Count + page are independent — run them on parallel pooled connections
    const [countRows, users] = await Promise.all([
      req.db.query(
        `SELECT COUNT(*) as total
         FROM users u
         LEFT JOIN credentials c ON c.accountId = u.accountId
         LEFT JOIN roles r ON r.roleId = u.roleId
         ${whereClause}`,
        params
      ),
      req.db.query(
        `SELECT
        u.accountId,
        u.firstName,
        u.lastName,
        u.phone,
        u.imageUrl,
        u.roleId,
        u.status,
        u.dateCreated,
        u.dateUpdated,
        c.email,
        r.roleName
      FROM users u
      LEFT JOIN credentials c ON c.accountId = u.accountId
      LEFT JOIN roles r ON r.roleId = u.roleId
      ${whereClause}
      ORDER BY u.${safeSortBy} ${safeSortOrder}
      LIMIT ? OFFSET ?`,
        [...params, Number(pageSize), Number(offset)]
      ),
    ]);
    const total = countRows[0]?.total || 0;

    return res.sendSuccess("Users retrieved successfully", {
      users: users.map((user) => ({ ...user, imageUrl: signUploadUrl(user.imageUrl) })),
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
 * GET /:userId
 * Get single user by accountId
 */
router.get(
  "/:userId",
  checkPermission("users", "list", "read"),
  catchAsync(async (req, res) => {
    const { userId } = req.params;

    const users = await req.db.query(
      `SELECT
        u.accountId,
        u.firstName,
        u.lastName,
        u.phone,
        u.imageUrl,
        u.signature,
        u.roleId,
        u.status,
        u.dateCreated,
        u.dateUpdated,
        c.email,
        r.roleName
      FROM users u
      LEFT JOIN credentials c ON c.accountId = u.accountId
      LEFT JOIN roles r ON r.roleId = u.roleId
      WHERE u.accountId = ? AND u.status != 'Deleted' AND r.roleName != 'Owner'
      LIMIT 1`,
      [userId]
    );

    if (users.length === 0) {
      return res.sendError("User not found", 404);
    }

    return res.sendSuccess("User retrieved successfully", {
      user: {
        ...users[0],
        imageUrl: signUploadUrl(users[0].imageUrl),
        signature: signUploadUrl(users[0].signature),
      },
    });
  })
);

/**
 * POST /
 * Create a new user + credential
 */
router.post(
  "/",
  checkPermission("users", "list", "write"),
  validateBody(createUserSchema),
  catchAsync(async (req, res) => {
    const { firstName, lastName, email, password, phone, roleId } = req.body;
    const now = getCurrentTimestampLocal();

    const problem = passwordProblem(password, { email });
    if (problem) {
      return res.sendError(problem, 400);
    }

    let conn;
    try {
      conn = await req.db.beginTransaction();

      // Check for duplicate email in credentials
      const [existingCred] = await conn.execute(
        `SELECT accountId FROM credentials 
         WHERE email = ? AND status != 'Deleted'
         LIMIT 1 FOR UPDATE`,
        [email]
      );

      if (existingCred.length > 0) {
        await req.db.rollback(conn);
        return res.sendError("A user with this email already exists", 409);
      }

      // The role must exist and must not be Owner
      const [roleRows] = await conn.execute(ASSIGNABLE_ROLE_SQL, [roleId]);

      if (roleRows.length === 0) {
        await req.db.rollback(conn);
        return res.sendError("Selected role was not found", 400);
      }

      // Generate UUID from MySQL
      const [uuidRow] = await conn.execute(`SELECT UUID() as id`);
      const accountId = uuidRow[0].id;

      // Create user
      await conn.execute(
        `INSERT INTO users (accountId, firstName, lastName, phone, roleId, status, dateCreated, dateUpdated)
         VALUES (?, ?, ?, ?, ?, 'Active', ?, ?)`,
        [accountId, firstName, lastName, phone || null, roleId, now, now]
      );

      // Create credential (Argon2 embeds the salt in the encoded hash).
      // The password was typed by an admin, so it is temporary: the user must
      // choose their own at first login (mustChangePassword = 1).
      const hash = await hashPassword(password);

      await conn.execute(
        `INSERT INTO credentials (accountId, email, password, type, status, mustChangePassword, dateCreated, dateUpdated)
         VALUES (?, ?, ?, 'ADMIN', 'Active', 1, ?, ?)`,
        [accountId, email, hash, now, now]
      );

      await req.db.commit(conn);

      return res.sendSuccess("User created successfully", { accountId }, 201);
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }
  })
);

/**
 * PUT /:userId
 * Update user
 */
router.put(
  "/:userId",
  checkPermission("users", "list", "write"),
  validateBody(updateUserSchema),
  catchAsync(async (req, res) => {
    const { userId } = req.params;
    const { firstName, lastName, phone, roleId, status } = req.body;
    const now = getCurrentTimestampLocal();

    // The new role must exist and must not be Owner
    const roleRows = await req.db.query(ASSIGNABLE_ROLE_SQL, [roleId]);

    if (roleRows.length === 0) {
      return res.sendError("Selected role was not found", 400);
    }

    // Joining the user's current role keeps Owner accounts out of reach
    const result = await req.db.query(
      `UPDATE users u
       INNER JOIN roles r ON r.roleId = u.roleId
       SET u.firstName = ?, u.lastName = ?, u.phone = ?, u.roleId = ?, u.status = ?, u.dateUpdated = ?
       WHERE u.accountId = ? AND u.status != 'Deleted' AND r.roleName != 'Owner'`,
      [firstName, lastName, phone || null, roleId, status || "Active", now, userId]
    );

    if (result.affectedRows === 0) {
      return res.sendError("User not found", 404);
    }

    return res.sendSuccess("User updated successfully");
  })
);

/**
 * DELETE /:userId
 * Soft delete user (sets status to 'Deleted')
 */
router.delete(
  "/:userId",
  checkPermission("users", "list", "write"),
  catchAsync(async (req, res) => {
    const { userId } = req.params;
    const now = getCurrentTimestampLocal();

    let conn;
    try {
      conn = await req.db.beginTransaction();

      // Soft delete user (Owner accounts are out of reach)
      const [userResult] = await conn.execute(
        `UPDATE users u
         INNER JOIN roles r ON r.roleId = u.roleId
         SET u.status = 'Deleted', u.dateUpdated = ?
         WHERE u.accountId = ? AND u.status != 'Deleted' AND r.roleName != 'Owner'`,
        [now, userId]
      );

      if (userResult.affectedRows === 0) {
        await req.db.rollback(conn);
        return res.sendError("User not found", 404);
      }

      // Soft delete credential
      await conn.execute(
        `UPDATE credentials SET status = 'Deleted', dateUpdated = ? WHERE accountId = ?`,
        [now, userId]
      );

      await req.db.commit(conn);

      return res.sendSuccess("User deleted successfully");
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }
  })
);

export default router;
