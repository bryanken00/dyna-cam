import { z } from "zod";
import { emptyToUndefined, queryEnum, queryEnumDefault, queryInt } from "./_helpers.js";

// POST /
export const createDeviceSchema = z.object({
  venueId: z.string().min(1, "Venue is required").max(50),
  name: z.string().trim().min(1, "Name is required").max(100),
});

// PUT /:deviceId
export const updateDeviceSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
});

// GET /
export const listDevicesQuerySchema = z.object({
  page: queryInt(1),
  pageSize: queryInt(10, { max: 100 }),
  search: z.string().max(100).optional().default(""),
  venueId: emptyToUndefined(z.string().max(50).optional()),
  status: queryEnum(["Active", "Revoked", "Deleted"]),
  sortBy: queryEnumDefault(["dateCreated", "name", "lastSeenAt"], "dateCreated"),
  sortOrder: queryEnumDefault(["ASC", "DESC"], "DESC"),
});
