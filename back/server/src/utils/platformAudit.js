import { logger } from "../../config/logger.js";
import { recordAudit } from "../middlewares/auditTrail.middleware.js";
import { getCurrentTimestampLocal } from "./dateUtils.js";
import { redactSecrets } from "./redact.js";

/**
 * PLAN-008 phase E: the back office's audit trail (`platform_audit_trail`).
 *
 * `recordPlatformAudit(req, event)` writes one row for a super-admin action. Like
 * recordAudit it never throws (a failed write is logged, the action stands) and
 * strips secrets from the metadata — passwords, temporary passwords and tokens never
 * reach it. `companyAudit(req, event)` ALSO writes the company action into that
 * company's own audit_trail as the actor "dgsports" (module "company"), so the
 * company's Owner sees what DGSports did (Admin → Audit trail shows "DGSports").
 */

/** audit_trail.accountId for actions DGSports took in the back office. */
export const PLATFORM_ACTOR_ID = "dgsports";

/** Every back-office action recorded (GET /backoffice/activity filters on these). */
export const PLATFORM_ACTIONS = [
  "LOGIN",
  "LOGIN_FAILED",
  "ACCOUNT_LOCKED",
  "LOGOUT",
  "PASSWORD_CHANGE",
  "COMPANY_CREATE",
  "COMPANY_UPDATE",
  "COMPANY_SUSPEND",
  "COMPANY_REACTIVATE",
  "OWNER_PASSWORD_RESET",
  "ADMIN_CREATE",
  "ADMIN_UPDATE",
  "ADMIN_DEACTIVATE",
  "ADMIN_REACTIVATE",
  "ADMIN_PASSWORD_RESET",
];

const cleanMetadata = (metadata) => {
  if (metadata === null || metadata === undefined) return null;
  const safe = redactSecrets(metadata);
  return typeof safe === "object" ? JSON.stringify(safe) : String(safe);
};

/**
 * @param {Object} req - Express request (db, IP, user agent; req.platformAdmin when signed in)
 * @param {Object} event
 * @param {string} event.action - one of PLATFORM_ACTIONS
 * @param {string|null} [event.platformAdminId] - defaults to req.platformAdmin (null: unknown)
 * @param {string|null} [event.companyId]
 * @param {string} [event.description]
 * @param {Object|null} [event.metadata]
 * @returns {Promise<boolean>} true when the row was written
 */
export const recordPlatformAudit = async (req, { action, platformAdminId, companyId = null, description, metadata }) => {
  const actor = platformAdminId === undefined ? req.platformAdmin?.platformAdminId || null : platformAdminId;
  try {
    const [{ auditId }] = await req.db.query(`SELECT UUID() AS auditId`);
    await req.db.query(
      `INSERT INTO platform_audit_trail
         (auditId, platformAdminId, action, companyId, description, metadata, ipAddress, userAgent, dateCreated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        auditId,
        actor,
        action,
        companyId,
        description || null,
        cleanMetadata(metadata),
        req.ip || null,
        req.get?.("user-agent") || null,
        getCurrentTimestampLocal(),
      ]
    );
    return true;
  } catch (err) {
    logger.error("Back-office audit write failed", { action, platformAdminId: actor, companyId, error: err.message });
    return false;
  }
};

/**
 * A back-office action on a company: one row in platform_audit_trail AND one in the
 * company's own audit_trail (actor "dgsports", module "company"). Never throws.
 */
export const companyAudit = async (req, { action, companyId, description, metadata }) => {
  await recordPlatformAudit(req, { action, companyId, description, metadata });
  await recordAudit(req, {
    action,
    module: "company",
    description: `DGSports: ${description}`,
    metadata: metadata ? redactSecrets(metadata) : null,
    actor: { accountId: PLATFORM_ACTOR_ID, companyId },
  });
};
