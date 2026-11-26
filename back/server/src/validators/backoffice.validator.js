import { z } from "zod";
import {
  emptyToUndefined,
  optionalEmail,
  optionalPhone,
  queryEnum,
  queryInt,
} from "./_helpers.js";

/**
 * PLAN-008 phase B: the back office — companies onboarded and managed by DGSports.
 * Sign-in, refresh and password change reuse the staff schemas (auth.validator.js).
 */

// Lowercase letters, numbers and single dashes, not at either end (checked without a
// nested-quantifier regex)
const isSlug = (value) =>
  /^[a-z0-9-]+$/.test(value) && !value.startsWith("-") && !value.endsWith("-") && !value.includes("--");

const companySlug = () =>
  emptyToUndefined(
    z
      .string()
      .trim()
      .toLowerCase()
      .max(60, "Keep the link at most 60 characters")
      .refine(isSlug, "Use lowercase letters, numbers and single dashes, e.g. bigpickle-inc")
      .optional()
  );

const companyName = () => z.string().trim().min(1, "Name the company").max(100);

// GET /companies
export const listCompaniesQuerySchema = z.object({
  search: emptyToUndefined(z.string().trim().max(100).optional()),
  status: queryEnum(["Active", "Suspended"]),
  page: queryInt(1),
  pageSize: queryInt(20, { max: 100 }),
});

// :companyId
export const companyIdParamsSchema = z.object({
  companyId: z.string().trim().min(1).max(50),
});

// POST /companies — the company and its Owner (who gets a temporary password)
export const createCompanySchema = z.object({
  name: companyName(),
  slug: companySlug(),
  contactEmail: optionalEmail(100),
  contactPhone: optionalPhone(),
  owner: z.object({
    firstName: z.string().trim().min(1, "Owner's first name is required").max(50),
    lastName: z.string().trim().min(1, "Owner's last name is required").max(50),
    email: z.string().trim().toLowerCase().min(1, "Owner's email is required").email("Invalid email address").max(100),
  }),
});

// PATCH /companies/:companyId — the edit form's details (status has its own routes).
// The contact fields are sent as the form holds them: ""/null/omitted clears one; a
// missing slug keeps the current one.
export const updateCompanySchema = z.object({
  name: companyName(),
  slug: companySlug(),
  contactEmail: optionalEmail(100),
  contactPhone: optionalPhone(),
});

// ── Phase E: super admins and the back office's activity ────────────────────

const personName = (label) => z.string().trim().min(1, `${label} is required`).max(50);

// :platformAdminId
export const platformAdminIdParamsSchema = z.object({
  platformAdminId: z.string().trim().min(1).max(50),
});

// GET /admins
export const listAdminsQuerySchema = z.object({
  status: queryEnum(["Active", "Inactive"]),
});

// POST /admins — a new super admin (gets a temporary password, shown once)
export const createAdminSchema = z.object({
  firstName: personName("First name"),
  lastName: personName("Last name"),
  email: z.string().trim().toLowerCase().min(1, "Email is required").email("Invalid email address").max(100),
});

// PATCH /admins/:platformAdminId — names only
export const updateAdminSchema = z.object({
  firstName: personName("First name"),
  lastName: personName("Last name"),
});

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const queryDate = () => emptyToUndefined(z.string().trim().regex(YMD, "Use a YYYY-MM-DD date").optional());

/** GET /activity — `actions` is utils/platformAudit.js PLATFORM_ACTIONS. */
export const activityQuerySchema = (actions) =>
  z.object({
    companyId: emptyToUndefined(z.string().trim().max(50).optional()),
    platformAdminId: emptyToUndefined(z.string().trim().max(50).optional()),
    action: queryEnum(actions),
    dateFrom: queryDate(),
    dateTo: queryDate(),
    page: queryInt(1),
    pageSize: queryInt(20, { max: 100 }),
  });
