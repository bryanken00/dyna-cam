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

// Pesos, 2 decimals; 0 = clips are free
const clipPrice = z.coerce
  .number()
  .min(0, "The price can't be negative")
  .max(100000, "The price is too high")
  .refine((value) => Math.round(value * 100) === value * 100, "Use at most 2 decimals");

// POST /
export const createVenueSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  address: optionalString(255),
  phone: optionalPhone(),
  logoUrl: optionalUploadPath(255),
  // CR-026: videos are kept 7 days unless the venue chooses otherwise
  clipRetentionDays: retentionDays.default(7),
  clipPrice: clipPrice.default(0),
});

// PUT /:venueId
export const updateVenueSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  address: optionalString(255),
  phone: optionalPhone(),
  logoUrl: optionalUploadPath(255),
  clipRetentionDays: retentionDays,
  clipPrice: clipPrice.default(0),
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
