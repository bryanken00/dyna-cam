import { z } from "zod";
import { emptyToUndefined, queryEnum, queryEnumDefault, queryInt } from "./_helpers.js";
import { COURT_SURFACES } from "../utils/venueFacts.js";

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
 * A live-stream ingest URL including its stream key, e.g.
 * rtmp://a.rtmp.youtube.com/live2/xxxx-xxxx-xxxx. Write-only like the camera.
 */
const optionalRtmpUrl = () =>
  emptyToUndefined(
    z
      .string()
      .trim()
      .max(500)
      .refine((value) => {
        try {
          return ["rtmp:", "rtmps:"].includes(new URL(value).protocol);
        } catch {
          return false;
        }
      }, "Enter the stream's RTMP address (with the stream key), starting with rtmp://")
      .optional()
  );

/** The public page players open to watch the stream (YouTube / Facebook link). */
const optionalWatchUrl = () =>
  emptyToUndefined(
    z
      .string()
      .trim()
      .max(255)
      .refine((value) => {
        try {
          return ["https:", "http:"].includes(new URL(value).protocol);
        } catch {
          return false;
        }
      }, "Enter the link players open to watch, starting with https://")
      .optional()
  );

/** What a court's stream shows (PLAN-002 Phase H). CAM2/STACKED need camera 2. */
export const STREAM_LAYOUTS = ["CAM1", "CAM2", "STACKED"];
const optionalLayout = () => emptyToUndefined(z.enum(STREAM_LAYOUTS).optional());

// PLAN-009 phase B: what the court is like (Discover's filters). Omitted keeps the stored
// value on an edit; "" / null clears it.
const surface = z.union([z.enum(COURT_SURFACES), z.literal(""), z.null()]).optional();
const isIndoor = z.boolean().nullable().optional();

// POST /
export const createCourtSchema = z.object({
  venueId: z.string().min(1, "Venue is required").max(50),
  name: z.string().trim().min(1, "Name is required").max(100),
  cameraRtspUrl: optionalRtspUrl(),
  // PLAN-002 Phase H: an optional second camera (needs camera 1)
  camera2RtspUrl: optionalRtspUrl(),
  streamEnabled: z.boolean().optional().default(false),
  streamRtmpUrl: optionalRtmpUrl(),
  streamWatchUrl: optionalWatchUrl(),
  streamLayout: optionalLayout(),
  surface,
  isIndoor,
});

// PUT /:courtId
// cameraRtspUrl is write-only: the API never sends it back. Omitted or ""
// keeps the stored one; removeCamera: true clears it.
export const updateCourtSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  cameraRtspUrl: optionalRtspUrl(),
  removeCamera: z.boolean().optional().default(false),
  // Camera 2 (Phase H), write-only the same way: omitted/"" keeps, removeCamera2 clears
  camera2RtspUrl: optionalRtspUrl(),
  removeCamera2: z.boolean().optional().default(false),
  // Omitted keeps the stored layout
  streamLayout: optionalLayout(),
  // Live stream: the RTMP address is write-only — omitted/"" keeps the stored
  // one, removeStream clears it (and turns streaming off)
  streamEnabled: z.boolean().optional().default(false),
  streamRtmpUrl: optionalRtmpUrl(),
  removeStream: z.boolean().optional().default(false),
  streamWatchUrl: optionalWatchUrl(),
  surface,
  isIndoor,
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
