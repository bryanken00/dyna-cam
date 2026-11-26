import { z } from "zod";
import {
  emptyToUndefined,
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

// CR-050: PSGC codes (digits) from the address lists, and the map pin
const psgcCode = (max) =>
  emptyToUndefined(z.string().trim().regex(/^\d+$/, "Pick it from the list").max(max).optional());
const coordinate = (label, limit) =>
  emptyToUndefined(
    z.coerce
      .number({ invalid_type_error: `${label} must be a number` })
      .min(-limit, `${label} must be between -${limit} and ${limit}`)
      .max(limit, `${label} must be between -${limit} and ${limit}`)
      .optional()
  );
const location = {
  regionCode: psgcCode(10),
  provinceCode: psgcCode(10),
  cityMunCode: psgcCode(12),
  barangayCode: psgcCode(12),
  street: optionalString(255),
  latitude: coordinate("Latitude", 90),
  longitude: coordinate("Longitude", 180),
};
// A pin is both numbers or neither
const pinComplete = (v) => (v.latitude === undefined) === (v.longitude === undefined);
const PIN_MESSAGE = { message: "Set both latitude and longitude, or clear the pin", path: ["latitude"] };

// POST /
export const createVenueSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  address: optionalString(255),
  phone: optionalPhone(),
  logoUrl: optionalUploadPath(255),
  // CR-026: videos are kept 7 days unless the venue chooses otherwise
  clipRetentionDays: retentionDays.default(7),
  clipPrice: clipPrice.default(0),
  ...location,
}).refine(pinComplete, PIN_MESSAGE);

// PUT /:venueId
export const updateVenueSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  address: optionalString(255),
  phone: optionalPhone(),
  logoUrl: optionalUploadPath(255),
  clipRetentionDays: retentionDays,
  clipPrice: clipPrice.default(0),
  status: z.enum(["Active", "Inactive"]).optional(),
  ...location,
}).refine(pinComplete, PIN_MESSAGE);

// GET /
export const listVenuesQuerySchema = z.object({
  page: queryInt(1),
  pageSize: queryInt(10, { max: 100 }),
  search: z.string().max(100).optional().default(""),
  status: queryEnum(["Active", "Inactive", "Deleted"]),
  sortBy: queryEnumDefault(["dateCreated", "dateUpdated", "name"], "dateCreated"),
  sortOrder: queryEnumDefault(["ASC", "DESC"], "DESC"),
});
