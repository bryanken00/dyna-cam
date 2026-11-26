import express from "express";

import { catchAsync, validateQuery } from "../../../utils/catchAsync.js";
import { PLATFORM_ACTIONS } from "../../../utils/platformAudit.js";
import { activityQuerySchema } from "../../../validators/backoffice.validator.js";

/**
 * PLAN-008 phase E: GET /backoffice/activity — the back office's audit trail
 * (platform_audit_trail), newest first, with the super admin's name / email and the
 * company's name. Filters: companyId, platformAdminId, action, dateFrom / dateTo
 * (YYYY-MM-DD, Manila), page / pageSize. Metadata never holds passwords or tokens.
 */
const router = express.Router();

router.get(
  "/",
  validateQuery(activityQuerySchema(PLATFORM_ACTIONS)),
  catchAsync(async (req, res) => {
    const { companyId, platformAdminId, action, dateFrom, dateTo, page, pageSize } = req.query;
    const conditions = [];
    const params = [];
    if (companyId) {
      conditions.push("t.companyId = ?");
      params.push(companyId);
    }
    if (platformAdminId) {
      conditions.push("t.platformAdminId = ?");
      params.push(platformAdminId);
    }
    if (action) {
      conditions.push("t.action = ?");
      params.push(action);
    }
    if (dateFrom) {
      conditions.push("t.dateCreated >= ?");
      params.push(`${dateFrom} 00:00:00`);
    }
    if (dateTo) {
      conditions.push("t.dateCreated <= ?");
      params.push(`${dateTo} 23:59:59`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const [countRows, rows] = await Promise.all([
      req.db.query(`SELECT COUNT(*) AS total FROM platform_audit_trail t ${where}`, params),
      req.db.query(
        `SELECT t.auditId, t.action, t.description, t.metadata, t.ipAddress, t.dateCreated,
                t.platformAdminId, a.firstName AS adminFirstName, a.lastName AS adminLastName,
                a.email AS adminEmail, t.companyId, c.name AS companyName
         FROM platform_audit_trail t
         LEFT JOIN platform_admins a ON a.platformAdminId = t.platformAdminId
         LEFT JOIN companies c ON c.companyId = t.companyId
         ${where}
         ORDER BY t.dateCreated DESC, t.id DESC
         LIMIT ${Number(pageSize)} OFFSET ${(Number(page) - 1) * Number(pageSize)}`,
        params
      ),
    ]);
    const total = Number(countRows[0]?.total || 0);

    return res.sendSuccess("Activity retrieved successfully", {
      activity: rows.map((r) => ({
        auditId: r.auditId,
        action: r.action,
        description: r.description,
        metadata: r.metadata,
        ipAddress: r.ipAddress,
        dateCreated: r.dateCreated,
        admin: r.platformAdminId
          ? {
              platformAdminId: r.platformAdminId,
              name: [r.adminFirstName, r.adminLastName].filter(Boolean).join(" ") || null,
              email: r.adminEmail || null,
            }
          : null,
        company: r.companyId ? { companyId: r.companyId, name: r.companyName || null } : null,
      })),
      actions: PLATFORM_ACTIONS,
      pagination: {
        page: Number(page),
        pageSize: Number(pageSize),
        total,
        totalPages: Math.ceil(total / Number(pageSize)),
      },
    });
  })
);

export default router;
