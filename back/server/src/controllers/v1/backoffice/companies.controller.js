import express from "express";

import { sendgridConfigured, sendMail } from "../../../lib/mailer/mailer.js";
import { companyWelcomeEmail } from "../../../lib/mailer/templates.js";
import { noIdempotencyCache } from "../../../middlewares/idempotency.middleware.js";
import { catchAsync, validateBody, validateParams, validateQuery } from "../../../utils/catchAsync.js";
import { DEVICE_ONLINE_SECONDS, secondsAgoLocal } from "../../../utils/clips.js";
import { createCompany, temporaryPassword } from "../../../utils/companies.js";
import { getCurrentTimestampLocal, moment } from "../../../utils/dateUtils.js";
import { hashPassword } from "../../../utils/hashing/argonHash.js";
import { companyAudit } from "../../../utils/platformAudit.js";
import {
  companyIdParamsSchema,
  createCompanySchema,
  listCompaniesQuerySchema,
  updateCompanySchema,
} from "../../../validators/backoffice.validator.js";

/**
 * PLAN-008 phase B: companies in the back office — DGSports onboards a company (with
 * its Owner), edits its details, suspends / reactivates it, and resets its Owner's
 * password. Behind requirePlatformAdmin + requirePlatformPasswordChanged (any active
 * super admin; there are no back-office roles yet). A Deleted or unknown company → 404.
 *
 * A company's own data (venues, bookings, …) is never shown here beyond counts.
 */
const router = express.Router();

const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";
const FORMAT = "YYYY-MM-DD HH:mm:ss";

/** Where staff sign in (the Admin portal), for the welcome email. */
const loginUrl = () =>
  `${(process.env.APP_URL || process.env.FRONTEND_URL || "http://localhost:4020")
    .split(",")[0]
    .trim()
    .replace(/\/$/, "")}/admin/login`;

/** This month's [start, next month's start) in Manila time. */
const thisMonth = () => {
  const start = moment().tz(TIMEZONE).startOf("month");
  return [start.format(FORMAT), start.clone().add(1, "month").format(FORMAT)];
};

/**
 * Per-company counts for the given companies: venues, courts, boxes (and online now),
 * bookings and games this month. → Map companyId → counts
 */
const companyCounts = async (db, companyIds) => {
  const counts = new Map(
    companyIds.map((id) => [
      id,
      { venues: 0, courts: 0, boxes: 0, boxesOnline: 0, bookingsThisMonth: 0, gamesThisMonth: 0 },
    ])
  );
  if (companyIds.length === 0) return counts;
  const [monthStart, monthEnd] = thisMonth();
  const onlineSince = secondsAgoLocal(DEVICE_ONLINE_SECONDS);

  const [venues, courts, boxes, bookings, games] = await Promise.all([
    db.query(
      `SELECT v.companyId, COUNT(*) AS n FROM venues v
       WHERE v.companyId IN (?) AND v.status != 'Deleted' GROUP BY v.companyId`,
      [companyIds]
    ),
    db.query(
      `SELECT v.companyId, COUNT(*) AS n FROM courts c
       INNER JOIN venues v ON v.venueId = c.venueId AND v.status != 'Deleted'
       WHERE v.companyId IN (?) AND c.status != 'Deleted' GROUP BY v.companyId`,
      [companyIds]
    ),
    db.query(
      `SELECT v.companyId, COUNT(*) AS n,
              SUM(d.lastSeenAt IS NOT NULL AND d.lastSeenAt >= ?) AS online
       FROM devices d
       INNER JOIN venues v ON v.venueId = d.venueId AND v.status != 'Deleted'
       WHERE v.companyId IN (?) AND d.status = 'Active' GROUP BY v.companyId`,
      [onlineSince, companyIds]
    ),
    db.query(
      `SELECT v.companyId, COUNT(*) AS n FROM bookings b
       INNER JOIN venues v ON v.venueId = b.venueId
       WHERE v.companyId IN (?) AND b.status NOT IN ('Cancelled', 'Expired', 'Deleted')
         AND b.startAt >= ? AND b.startAt < ?
       GROUP BY v.companyId`,
      [companyIds, monthStart, monthEnd]
    ),
    db.query(
      `SELECT v.companyId, COUNT(*) AS n FROM recording_sessions s
       INNER JOIN venues v ON v.venueId = s.venueId
       WHERE v.companyId IN (?) AND s.status NOT IN ('Cancelled', 'Failed')
         AND s.startAt >= ? AND s.startAt < ?
       GROUP BY v.companyId`,
      [companyIds, monthStart, monthEnd]
    ),
  ]);

  const put = (rows, key, valueKey = "n") => {
    for (const row of rows) {
      const entry = counts.get(row.companyId);
      if (entry) entry[key] = Number(row[valueKey] || 0);
    }
  };
  put(venues, "venues");
  put(courts, "courts");
  put(boxes, "boxes");
  put(boxes, "boxesOnline", "online");
  put(bookings, "bookingsThisMonth");
  put(games, "gamesThisMonth");
  return counts;
};

const companyView = (c) => ({
  companyId: c.companyId,
  name: c.name,
  slug: c.slug,
  contactEmail: c.contactEmail,
  contactPhone: c.contactPhone,
  status: c.status,
  isDefault: c.slug === "default",
  dateCreated: c.dateCreated,
  dateUpdated: c.dateUpdated,
});

/** The company (not Deleted) or null. */
const findCompany = async (db, companyId) => {
  const rows = await db.query(
    `SELECT companyId, name, slug, contactEmail, contactPhone, status, dateCreated, dateUpdated
     FROM companies WHERE companyId = ? AND status != 'Deleted' LIMIT 1`,
    [companyId]
  );
  return rows[0] || null;
};

/** The company's Owner account (its first Active Owner), or null. */
const findOwner = async (db, companyId) => {
  const rows = await db.query(
    `SELECT u.accountId, u.firstName, u.lastName, c.email, c.mustChangePassword, c.status AS credentialStatus
     FROM users u
     INNER JOIN roles r ON r.roleId = u.roleId AND r.roleName = 'Owner' AND r.companyId = ?
     INNER JOIN credentials c ON c.accountId = u.accountId AND c.status != 'Deleted'
     WHERE u.companyId = ? AND u.status != 'Deleted'
     ORDER BY u.id ASC
     LIMIT 1`,
    [companyId, companyId]
  );
  return rows[0] || null;
};

/** GET / — companies (search by name / slug / contact email; status filter), newest first. */
router.get(
  "/",
  validateQuery(listCompaniesQuerySchema),
  catchAsync(async (req, res) => {
    const { search, status, page, pageSize } = req.query;
    const where = ["c.status != 'Deleted'"];
    const params = [];
    if (status) {
      where.push("c.status = ?");
      params.push(status);
    }
    if (search) {
      where.push("(c.name LIKE ? OR c.slug LIKE ? OR c.contactEmail LIKE ?)");
      const like = `%${search.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
      params.push(like, like, like);
    }
    const whereSql = where.join(" AND ");

    const [[{ total }], rows, [{ active, suspended }]] = await Promise.all([
      req.db.query(`SELECT COUNT(*) AS total FROM companies c WHERE ${whereSql}`, params).then((r) => [r]),
      req.db.query(
        `SELECT c.companyId, c.name, c.slug, c.contactEmail, c.contactPhone, c.status, c.dateCreated,
                c.dateUpdated
         FROM companies c
         WHERE ${whereSql}
         ORDER BY c.id DESC
         LIMIT ${Number(pageSize)} OFFSET ${(Number(page) - 1) * Number(pageSize)}`,
        params
      ),
      req.db.query(
        `SELECT SUM(status = 'Active') AS active, SUM(status = 'Suspended') AS suspended
         FROM companies WHERE status != 'Deleted'`
      ),
    ]);

    const counts = await companyCounts(
      req.db,
      rows.map((c) => c.companyId)
    );
    return res.sendSuccess("Companies retrieved successfully", {
      companies: rows.map((c) => ({ ...companyView(c), counts: counts.get(c.companyId) })),
      stats: { active: Number(active || 0), suspended: Number(suspended || 0) },
      pagination: { page: Number(page), pageSize: Number(pageSize), total: Number(total) },
    });
  })
);

/** GET /:companyId — details, counts and its Owner. */
router.get(
  "/:companyId",
  validateParams(companyIdParamsSchema),
  catchAsync(async (req, res) => {
    const company = await findCompany(req.db, req.params.companyId);
    if (!company) return res.sendError("Company not found", 404);
    const [counts, owner] = await Promise.all([
      companyCounts(req.db, [company.companyId]),
      findOwner(req.db, company.companyId),
    ]);
    return res.sendSuccess("Company retrieved successfully", {
      company: {
        ...companyView(company),
        counts: counts.get(company.companyId),
        owner: owner
          ? {
              firstName: owner.firstName,
              lastName: owner.lastName,
              email: owner.email,
              mustChangePassword: Boolean(owner.mustChangePassword),
            }
          : null,
      },
    });
  })
);

/**
 * POST / — onboard a company: the company, its Owner role and Owner account (a
 * temporary password, shown in this reply once and emailed when SendGrid is set up).
 */
router.post(
  "/",
  validateBody(createCompanySchema),
  catchAsync(async (req, res) => {
    const { name, slug, contactEmail, contactPhone, owner } = req.body;
    let conn;
    let made;
    try {
      conn = await req.db.beginTransaction();
      made = await createCompany(conn, {
        name,
        slug,
        contactEmail: contactEmail || null,
        contactPhone: contactPhone || null,
        owner,
      });
      if (!made.ok) {
        await req.db.rollback(conn);
        return res.sendError(made.message, made.status);
      }
      await req.db.commit(conn);
    } catch (err) {
      if (conn) await req.db.rollback(conn);
      // Two onboardings racing for the same slug / email
      if (err.code === "ER_DUP_ENTRY") {
        return res.sendError("That company link or Owner email is already used", 409);
      }
      throw err;
    }

    // After commit: the welcome email never fails the onboarding
    let welcomeSent = false;
    if (sendgridConfigured()) {
      const mail = await sendMail({
        to: owner.email,
        ...companyWelcomeEmail({
          ownerName: owner.firstName,
          companyName: name,
          loginUrl: loginUrl(),
          email: owner.email,
          password: made.ownerPassword,
        }),
      });
      welcomeSent = Boolean(mail?.sent);
    }

    // PLAN-008 phase E: the back office's audit trail + the company's own (never the password)
    await companyAudit(req, {
      action: "COMPANY_CREATE",
      companyId: made.companyId,
      description: `Onboarded ${name} with Owner ${owner.email}`,
      metadata: { name, slug: made.slug, ownerEmail: owner.email, welcomeSent },
    });

    // The reply carries a password: never replay it from the idempotency store
    noIdempotencyCache(res);
    return res.sendSuccess(
      "Company onboarded",
      {
        companyId: made.companyId,
        slug: made.slug,
        owner: { email: owner.email, temporaryPassword: made.ownerPassword },
        welcomeSent,
      },
      201
    );
  })
);

/** PATCH /:companyId — name, link (slug), contact email / phone. */
router.patch(
  "/:companyId",
  validateParams(companyIdParamsSchema),
  validateBody(updateCompanySchema),
  catchAsync(async (req, res) => {
    const company = await findCompany(req.db, req.params.companyId);
    if (!company) return res.sendError("Company not found", 404);
    const { name, slug, contactEmail, contactPhone } = req.body;
    const nextSlug = slug || company.slug;
    if (company.slug === "default" && nextSlug !== "default") {
      return res.sendError("The default company's link can't change", 400);
    }
    if (nextSlug !== company.slug) {
      const taken = await req.db.query(`SELECT 1 FROM companies WHERE slug = ? AND companyId != ? LIMIT 1`, [
        nextSlug,
        company.companyId,
      ]);
      if (taken.length > 0) return res.sendError(`The company link "${nextSlug}" is already used — pick another`, 409);
    }
    try {
      await req.db.query(
        `UPDATE companies SET name = ?, slug = ?, contactEmail = ?, contactPhone = ?, dateUpdated = ?
         WHERE companyId = ? AND status != 'Deleted'`,
        [name, nextSlug, contactEmail || null, contactPhone || null, getCurrentTimestampLocal(), company.companyId]
      );
    } catch (err) {
      if (err.code === "ER_DUP_ENTRY") return res.sendError(`The company link "${nextSlug}" is already used`, 409);
      throw err;
    }
    const after = { name, slug: nextSlug, contactEmail: contactEmail || null, contactPhone: contactPhone || null };
    const changed = Object.keys(after).filter((key) => (company[key] ?? null) !== after[key]);
    if (changed.length > 0) {
      await companyAudit(req, {
        action: "COMPANY_UPDATE",
        companyId: company.companyId,
        description: `Updated the company's ${changed.join(", ")}`,
        metadata: {
          before: Object.fromEntries(changed.map((key) => [key, company[key] ?? null])),
          after: Object.fromEntries(changed.map((key) => [key, after[key]])),
        },
      });
    }
    return res.sendSuccess("Company updated", { company: companyView(await findCompany(req.db, company.companyId)) });
  })
);

/**
 * POST /:companyId/suspend — its staff can't sign in (their tokens stop working) and
 * its venues stop taking online bookings; bookings and games already made stay.
 */
router.post(
  "/:companyId/suspend",
  validateParams(companyIdParamsSchema),
  catchAsync(async (req, res) => {
    const company = await findCompany(req.db, req.params.companyId);
    if (!company) return res.sendError("Company not found", 404);
    if (company.status !== "Suspended") {
      const now = getCurrentTimestampLocal();
      const result = await req.db.query(
        `UPDATE companies SET status = 'Suspended', dateUpdated = ? WHERE companyId = ? AND status = 'Active'`,
        [now, company.companyId]
      );
      if (result.affectedRows > 0) {
        await companyAudit(req, {
          action: "COMPANY_SUSPEND",
          companyId: company.companyId,
          description: `Suspended ${company.name}`,
        });
      }
      // End its staff's sessions now (their access tokens stop at the next request too)
      await req.db.query(
        `UPDATE refresh_tokens t INNER JOIN users u ON u.accountId = t.accountId
         SET t.revokedAt = ?, t.dateUpdated = ?
         WHERE u.companyId = ? AND t.revokedAt IS NULL`,
        [now, now, company.companyId]
      );
    }
    return res.sendSuccess("Company suspended", { company: companyView(await findCompany(req.db, company.companyId)) });
  })
);

/** POST /:companyId/reactivate — back to Active. */
router.post(
  "/:companyId/reactivate",
  validateParams(companyIdParamsSchema),
  catchAsync(async (req, res) => {
    const company = await findCompany(req.db, req.params.companyId);
    if (!company) return res.sendError("Company not found", 404);
    const result = await req.db.query(
      `UPDATE companies SET status = 'Active', dateUpdated = ? WHERE companyId = ? AND status = 'Suspended'`,
      [getCurrentTimestampLocal(), company.companyId]
    );
    if (result.affectedRows > 0) {
      await companyAudit(req, {
        action: "COMPANY_REACTIVATE",
        companyId: company.companyId,
        description: `Reactivated ${company.name}`,
      });
    }
    return res.sendSuccess("Company reactivated", { company: companyView(await findCompany(req.db, company.companyId)) });
  })
);

/**
 * POST /:companyId/owner/reset-password — a new temporary password for the company's
 * Owner (shown once), which they must change at next sign-in; their sessions end and
 * a lockout is cleared.
 */
router.post(
  "/:companyId/owner/reset-password",
  validateParams(companyIdParamsSchema),
  catchAsync(async (req, res) => {
    const company = await findCompany(req.db, req.params.companyId);
    if (!company) return res.sendError("Company not found", 404);
    const owner = await findOwner(req.db, company.companyId);
    if (!owner) return res.sendError("This company has no Owner account", 404);

    const password = temporaryPassword(owner.email);
    const now = getCurrentTimestampLocal();
    await req.db.query(
      `UPDATE credentials
       SET password = ?, mustChangePassword = 1, failedLoginAttempts = 0, lockedUntil = NULL, dateUpdated = ?
       WHERE accountId = ?`,
      [await hashPassword(password), now, owner.accountId]
    );
    await req.db.query(
      `UPDATE refresh_tokens SET revokedAt = ?, dateUpdated = ? WHERE accountId = ? AND revokedAt IS NULL`,
      [now, now, owner.accountId]
    );

    await companyAudit(req, {
      action: "OWNER_PASSWORD_RESET",
      companyId: company.companyId,
      description: `Reset the Owner's password (${owner.email}); they choose a new one at next sign-in`,
      metadata: { ownerEmail: owner.email },
    });

    noIdempotencyCache(res);
    return res.sendSuccess("Owner's password reset", {
      owner: { email: owner.email, temporaryPassword: password },
    });
  })
);

export default router;
