import { z } from "zod";
import {
  optionalPhone,
  optionalString,
  optionalUploadPath,
  queryEnum,
  queryEnumDefault,
  queryInt,
} from "./_helpers.js";

const retentionDays = z.coerce
  .number()
  .int("Retention must be a whole number of days")
  .min(1, "Keep clips for at least 1 day")
  .max(365, "Keep clips for at most 365 days");

// POST /
export const createVenueSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  address: optionalString(255),
  phone: optionalPhone(),
  logoUrl: optionalUploadPath(255),
  clipRetentionDays: retentionDays.default(30),
});

// PUT /:venueId
export const updateVenueSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  address: optionalString(255),
  phone: optionalPhone(),
  logoUrl: optionalUploadPath(255),
  clipRetentionDays: retentionDays,
  status: z.enum(["Active", "Inactive"]).optional(),
});

// GET /
export const listVenuesQuerySchema = z.object({
  page: queryInt(1),
  pageSize: queryInt(10, { max: 100 }),
  search: z.string().max(100).optional().default(""),
  status: queryEnum(["Active", "Inactive", "Deleted"]),
  sortBy: queryEnumDefault(["dateCreated", "dateUpdated", "name"], "dateCreated"),
  sortOrder: queryEnumDefault(["ASC", "DESC"], "DESC"),
});
