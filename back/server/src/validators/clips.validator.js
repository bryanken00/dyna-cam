import { z } from "zod";
import { emptyToUndefined, queryEnum, queryEnumDefault, queryInt } from "./_helpers.js";

const optionalDate = () =>
  emptyToUndefined(
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date")
      .optional()
  );

// POST / — staff "save this court's last 60 seconds now"
export const createClipSchema = z.object({
  courtId: z.string().min(1, "Court is required").max(50),
});

// GET /
export const listClipsQuerySchema = z.object({
  page: queryInt(1),
  pageSize: queryInt(20, { max: 100 }),
  venueId: emptyToUndefined(z.string().max(50).optional()),
  courtId: emptyToUndefined(z.string().max(50).optional()),
  source: queryEnum(["QR", "BUTTON", "SESSION", "STAFF"]),
  status: queryEnum(["Pending", "Processing", "Ready", "Failed", "Expired", "Deleted"]),
  dateFrom: optionalDate(),
  dateTo: optionalDate(),
  sortBy: queryEnumDefault(["requestedAt", "dateCreated"], "requestedAt"),
  sortOrder: queryEnumDefault(["ASC", "DESC"], "DESC"),
});
