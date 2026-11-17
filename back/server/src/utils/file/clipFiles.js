import fs from "node:fs";
import path from "node:path";
import { uploadFolderId } from "./uploads.js";

/**
 * Where recorder boxes' clips are stored, and how they are removed.
 *
 *   public/uploads/admin/clips/{venueId}/{clipId}/<random>.mp4 / .jpg
 *
 * Only the server builds these paths (from the clip row, never from the
 * request), and removal refuses anything outside the clips folder.
 */

const CLIPS_ROOT = path.resolve("public", "uploads", "admin", "clips");

/** multer `filePath` for a clip's files (relative to public/). */
export const clipUploadFolder = (venueId, clipId) =>
  `uploads/admin/clips/${uploadFolderId(venueId)}/${uploadFolderId(clipId)}`;

/** Stored path ("/public/uploads/…") of a file multer just wrote. */
export const toStoredUploadPath = (file) => `/${file.path.replace(/\\/g, "/")}`;

/**
 * Delete a clip's stored files. Missing files are fine; a path outside the
 * clips folder is skipped. Empty clip folders are removed too — they only
 * ever hold that one clip's files.
 */
export const removeClipFiles = async (...storedPaths) => {
  const folders = new Set();
  for (const stored of storedPaths) {
    if (typeof stored !== "string" || !stored) continue;
    const absolute = path.resolve(stored.replace(/^[/\\]+/, ""));
    if (!absolute.startsWith(CLIPS_ROOT + path.sep)) continue;
    await fs.promises.unlink(absolute).catch(() => {});
    folders.add(path.dirname(absolute));
  }
  for (const folder of folders) {
    // rmdir only succeeds on an empty folder, which is exactly what we want
    await fs.promises.rmdir(folder).catch(() => {});
  }
};
