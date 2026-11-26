import { selectRows } from "./dbRows.js";

/**
 * PLAN-008: the company rule for the Admin portal. Every Admin query is scoped to
 * the caller's company (`req.user.companyId`):
 *
 *  - tables with their own `companyId` (venues, users, roles, settings, audit_trail):
 *    `AND x.companyId = ?`
 *  - everything under a venue (courts, devices, games, bookings, payments, clips, …):
 *    `AND ${inCompanyVenues("x")}` with the companyId as its one parameter
 *  - a by-ID request for another company's record answers 404, like a missing one
 *  - an ID the client sends (venueId, courtId, roleId, …) is checked before it's used
 *
 * Background jobs and the public / device / app routes work across companies (their
 * own credential scopes them); only staff notifications pick people by company.
 */

/**
 * SQL: the row's venue belongs to the company — one `?` (the companyId).
 * @param {string} alias - the table alias whose `venueId` column to check
 * @param {string} [column="venueId"]
 */
export const inCompanyVenues = (alias, column = "venueId") =>
  `${alias}.${column} IN (SELECT cv.venueId FROM venues cv WHERE cv.companyId = ?)`;

/**
 * SQL: the row's court belongs to the company — one `?` (the companyId).
 * @param {string} alias - the table alias whose `courtId` column to check
 */
export const inCompanyCourts = (alias, column = "courtId") =>
  `${alias}.${column} IN (SELECT cc.courtId FROM courts cc
     INNER JOIN venues ccv ON ccv.venueId = cc.venueId WHERE ccv.companyId = ?)`;

/** The caller's company (throws if a route forgot requireAuth — never silently unscoped). */
export const callerCompany = (req) => {
  const companyId = req.user?.companyId;
  if (!companyId) throw new Error("companyScope: no req.user.companyId — is the route behind requireAuth?");
  return companyId;
};

/** Is this venue (not Deleted) in the company? `db` = req.db or a transaction connection. */
export const venueInCompany = async (db, venueId, companyId) => {
  if (!venueId) return false;
  const rows = await selectRows(
    db,
    `SELECT 1 FROM venues WHERE venueId = ? AND companyId = ? AND status != 'Deleted' LIMIT 1`,
    [venueId, companyId]
  );
  return rows.length > 0;
};

/** Is this court (not Deleted, at a venue of the company)? */
export const courtInCompany = async (db, courtId, companyId) => {
  if (!courtId) return false;
  const rows = await selectRows(
    db,
    `SELECT 1 FROM courts c INNER JOIN venues v ON v.venueId = c.venueId
     WHERE c.courtId = ? AND c.status != 'Deleted' AND v.companyId = ? LIMIT 1`,
    [courtId, companyId]
  );
  return rows.length > 0;
};

/** Is this role (any status but Deleted) the company's? */
export const roleInCompany = async (db, roleId, companyId) => {
  if (!roleId) return false;
  const rows = await selectRows(db, `SELECT 1 FROM roles WHERE roleId = ? AND companyId = ? LIMIT 1`, [
    roleId,
    companyId,
  ]);
  return rows.length > 0;
};
