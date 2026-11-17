import { z } from "zod";
import { emptyToUndefined, queryEnum, queryEnumDefault, queryInt } from "./_helpers.js";

/**
 * The court camera's RTSP URL, e.g. rtsp://user:pass@192.168.1.50:554/stream1.
 * Optional: a court can be set up before its camera is installed.
 */
const optionalRtspUrl = () =>
  emptyToUndefined(
    z
      .string()
      .trim()
      .max(500)
      .refine((value) => {
        try {
          return ["rtsp:", "rtsps:"].includes(new URL(value).protocol);
        } catch {
          return false;
        }
      }, "Enter the camera's RTSP address, starting with rtsp://")
      .optional()
  );

/**
 * The code a court's physical button sends to the recorder box
 * (http://<box>:<port>/press/<code>). Letters, digits, - and _.
 */
const optionalButtonCode = () =>
  emptyToUndefined(
    z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{3,32}$/, "Use 3–32 letters, digits, - or _")
      .optional()
  );

// POST /
export const createCourtSchema = z.object({
  venueId: z.string().min(1, "Venue is required").max(50),
  name: z.string().trim().min(1, "Name is required").max(100),
  cameraRtspUrl: optionalRtspUrl(),
  buttonCode: optionalButtonCode(),
});

// PUT /:courtId
// cameraRtspUrl is write-only: the API never sends it back. Omitted or ""
// keeps the stored one; removeCamera: true clears it.
export const updateCourtSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  cameraRtspUrl: optionalRtspUrl(),
  removeCamera: z.boolean().optional().default(false),
  // Full update like the other fields: omitted/"" clears the button
  buttonCode: optionalButtonCode(),
  status: z.enum(["Active", "Inactive"]).optional(),
});

// GET /
export const listCourtsQuerySchema = z.object({
  page: queryInt(1),
  pageSize: queryInt(10, { max: 100 }),
  search: z.string().max(100).optional().default(""),
  venueId: emptyToUndefined(z.string().max(50).optional()),
  status: queryEnum(["Active", "Inactive", "Deleted"]),
  sortBy: queryEnumDefault(["dateCreated", "dateUpdated", "name"], "name"),
  sortOrder: queryEnumDefault(["ASC", "DESC"], "ASC"),
});
