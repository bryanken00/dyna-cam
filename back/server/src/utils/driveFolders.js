import { toEpochMs } from "./clips.js";
import { createFolder, folderUsable, folderViewUrl, shareWithLink } from "./googleDrive.js";

/**
 * Where a court's videos live in its Google Drive, and what they're called —
 * for CR-040's direct upload from the venue box
 * (controllers/v1/device/game-videos.controller.js), the same folders and names
 * the API's own Drive upload used before (removed in CR-040 Phase 4).
 *
 *   DGSports · <venue> · <court>/          the court's folder (courts.driveFolderId)
 *     2026-11-24 10.00 game/                one game, shared by link (recording_sessions.driveFolderId / driveUrl)
 *       Cam 1 – whole game.mp4
 *       Save 8m00s–10m00s – Cam 1.mp4
 */

/** "2026-11-17 14:05:03" → "2026-11-17 14.05.03" (no colons in Drive names on Windows sync) */
export const stamp = (local) => String(local || "").replace(/:/g, ".");

/** The court's folder name in Drive. */
// CR-036: new courts' folders; an existing folder keeps the name it was made with
const courtFolderName = (row) => `DGSports · ${row.venueName} · ${row.courtName}`;

/**
 * The court's folder, made on first use and again if it was deleted. Stored
 * only while the court still has the same sign-in (a change of account in the
 * meantime must not get the old account's folder).
 *
 * @param row - { courtId, venueName, courtName, driveFolderId, driveRefreshToken } (driveFolderId updated in place)
 */
export const courtFolder = async (db, token, row) => {
  if (row.driveFolderId && (await folderUsable(token, row.driveFolderId))) {
    return row.driveFolderId;
  }
  const folder = await createFolder(token, { name: courtFolderName(row) });
  await db.query(
    `UPDATE courts SET driveFolderId = ? WHERE courtId = ? AND driveRefreshToken = ?`,
    [folder.id, row.courtId, row.driveRefreshToken]
  );
  row.driveFolderId = folder.id;
  return folder.id;
};

/**
 * A whole game's own shared folder inside the court's folder.
 * @param row - { sessionId, sessionStartAt, sessionFolderId } (sessionFolderId updated in place)
 */
export const sessionFolder = async (db, token, row, parentId) => {
  if (row.sessionFolderId && (await folderUsable(token, row.sessionFolderId))) {
    return row.sessionFolderId;
  }
  const name = `${stamp(row.sessionStartAt).slice(0, 16)} game`;
  const folder = await createFolder(token, { name, parentId });
  await shareWithLink(token, folder.id);
  await db.query(
    `UPDATE recording_sessions SET driveFolderId = ?, driveUrl = ? WHERE sessionId = ?`,
    [folder.id, folderViewUrl(folder.id, folder.webViewLink), row.sessionId]
  );
  row.sessionFolderId = folder.id;
  return folder.id;
};

/**
 * A whole-game video's or a save's file name: "Cam 1 – whole game.mp4", or
 * "Whole game.mp4" on a one-camera court; CR-013 saves: "Save 8m00s–10m00s – Cam 1.mp4".
 * @param row - { camera, sessionStartAt, captureStartAt?, captureEndAt? }
 */
export const sessionVideoFileName = (row) => {
  if (row.captureStartAt) {
    const at = (value) => {
      const total = Math.max(0, Math.round((toEpochMs(value) - toEpochMs(row.sessionStartAt)) / 1000));
      return `${Math.floor(total / 60)}m${String(total % 60).padStart(2, "0")}s`;
    };
    const span = `${at(row.captureStartAt)}–${at(row.captureEndAt)}`;
    return row.camera ? `Save ${span} – Cam ${row.camera}.mp4` : `Save ${span}.mp4`;
  }
  return row.camera ? `Cam ${row.camera} – whole game.mp4` : "Whole game.mp4";
};
