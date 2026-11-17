import { logger } from "../../config/logger.js";
import { getCurrentTimestampLocal } from "../utils/dateUtils.js";

/**
 * Audit Trail
 *
 * Two ways to write to the audit_trail table:
 *
 * 1. `auditTrail(module)` — middleware. Logs every successful POST, PUT, PATCH,
 *    DELETE of a route group. Mount AFTER the auth middleware (it needs req.user):
 *
 *      router.use("/users", requireAuth, auditTrail("users"), usersController);
 *
 * 2. `recordAudit(req, event)` — call it directly for events the middleware
 *    cannot see: sign-in, failed sign-in, lockout, logout, password changes.
 *    There is often no req.user at that point, so the actor is passed in.
 *
 * Both write the row BEFORE the response is sent, so a client never sees a
 * success that has no audit record yet. A failed write does not undo the
 * action; it is logged at error level with the event, so it is never silent.
 */

// Map HTTP methods to action verbs
const METHOD_ACTION_MAP = {
  POST: "CREATE",
  PUT: "UPDATE",
  PATCH: "UPDATE",
  DELETE: "DELETE",
};

// Never copied into audit metadata
const SENSITIVE_FIELDS = [
  "password",
  "currentPassword",
  "newPassword",
  "oldPassword",
  "confirmPassword",
  "salt",
  "token",
  "refreshToken",
  "secret",
];

/**
 * Insert one audit row. Never throws: an audit failure must not turn a
 * finished action into an error response.
 *
 * @param {Object} req - Express request (for db, IP, user agent)
 * @param {Object} event
 * @param {string} event.action - e.g. "CREATE", "LOGIN", "LOGIN_FAILED"
 * @param {string} event.module - e.g. "users", "auth"
 * @param {string} [event.description]
 * @param {Object|string|null} [event.metadata]
 * @param {Object} [event.actor] - defaults to req.user
 * @param {string} event.actor.accountId
 * @returns {Promise<boolean>} true when the row was written
 */
export async function recordAudit(req, { action, module, description, metadata, actor }) {
  const { accountId } = actor || req.user || {};

  try {
    if (!accountId) {
      throw new Error("audit event has no actor");
    }

    const [{ auditId }] = await req.db.query(`SELECT UUID() as auditId`);

    await req.db.query(
      `INSERT INTO audit_trail (auditId, accountId, action, module, description, metadata, ipAddress, userAgent, dateCreated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        auditId,
        accountId,
        action,
        module,
        description || null,
        metadata && typeof metadata === "object" ? JSON.stringify(metadata) : metadata || null,
        req.ip || null,
        req.get("user-agent") || null,
        getCurrentTimestampLocal(),
      ]
    );

    return true;
  } catch (err) {
    (req.logger || logger).error("Audit trail logging failed", {
      error: err.message,
      action,
      module,
      accountId: accountId || null,
    });
    return false;
  }
}

/**
 * Create audit trail middleware
 * @param {string} [moduleName] - Optional module name override. If not provided, inferred from URL.
 */
export const auditTrail = (moduleName) => {
  return (req, res, next) => {
    // Only log state-changing methods
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      return next();
    }

    // Wrap res.json so the audit row is written before the response goes out
    const originalJson = res.json.bind(res);

    res.json = function (body) {
      // Only log successful operations (2xx status codes)
      // A route can opt out for requests that change no business data (e.g. a
      // camera-setup page asking for a fresh preview every 90 s)
      if (res.statusCode >= 200 && res.statusCode < 300 && req.user && !res.locals.skipAudit) {
        const action = METHOD_ACTION_MAP[req.method] || req.method;
        const module = moduleName || inferModule(req.originalUrl);

        recordAudit(req, {
          action,
          module,
          description: buildDescription(action, module, req),
          metadata: buildMetadata(req, body),
        }).finally(() => originalJson(body));

        return res;
      }

      return originalJson(body);
    };

    next();
  };
};

/**
 * Infer module name from the request URL
 * /api/v1/admin/users/123 → "users"
 * /api/v1/admin/roles/456/permissions → "roles"
 */
function inferModule(url) {
  // Remove the /api/v1/admin/ prefix and the query string
  const cleaned = url.replace(/^\/api\/v1\/admin\//, "").split("?")[0];

  // Get first path segment as module
  const firstSegment = cleaned.split("/")[0];
  return firstSegment || "unknown";
}

/**
 * Build a human-readable description
 */
function buildDescription(action, module, req) {
  const entityId = req.params?.userId || req.params?.roleId || req.params?.accountId || null;

  if (entityId) {
    return `${action} ${module} (${entityId})`;
  }

  return `${action} ${module}`;
}

/**
 * Build metadata (sanitized — no passwords or sensitive data)
 */
function buildMetadata(req, responseBody) {
  const metadata = {};

  // Include safe request body fields (exclude sensitive data)
  if (req.body && typeof req.body === "object") {
    const safeBody = {};

    for (const [key, value] of Object.entries(req.body)) {
      if (!SENSITIVE_FIELDS.includes(key)) {
        safeBody[key] = value;
      }
    }

    if (Object.keys(safeBody).length > 0) {
      metadata.body = safeBody;
    }
  }

  // Include route params
  if (req.params && Object.keys(req.params).length > 0) {
    metadata.params = req.params;
  }

  // Include response data ID if available
  if (responseBody?.data) {
    const { accountId, roleId } = responseBody.data;
    const ids = { accountId, roleId };
    const filtered = Object.fromEntries(Object.entries(ids).filter(([, v]) => v));
    if (Object.keys(filtered).length > 0) {
      metadata.createdIds = filtered;
    }
  }

  return Object.keys(metadata).length > 0 ? metadata : null;
}

export default auditTrail;
