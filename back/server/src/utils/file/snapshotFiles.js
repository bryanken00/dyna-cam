import fs from "node:fs";
import path from "node:path";
import { uploadFolderId } from "./uploads.js";

/**
 * Court preview snapshots (PLAN-002): the recorder box uploads a JPEG from its
 * latest recording while someone is setting the camera up.
 *
 *   public/uploads/admin/snapshots/{venueId}/{courtId}/<random>.jpg
 *
 * Only the newest is kept: each upload replaces the previous file. Paths are
 * built from the court row, never from the request.
 */

const SNAPSHOTS_ROOT = path.resolve("public", "uploads", "admin", "snapshots");

/** multer `filePath` for a court's snapshot (relative to public/). */
export const snapshotUploadFolder = (venueId, courtId) =>
  `uploads/admin/snapshots/${uploadFolderId(venueId)}/${uploadFolderId(courtId)}`;

/** Delete a stored snapshot; anything outside the snapshots folder is ignored. */
export const removeSnapshotFile = async (storedPath) => {
  if (typeof storedPath !== "string" || !storedPath) return;
  const absolute = path.resolve(storedPath.replace(/^[/\\]+/, ""));
  if (!absolute.startsWith(SNAPSHOTS_ROOT + path.sep)) return;
  await fs.promises.unlink(absolute).catch(() => {});
};
