import { getCurrentTimestampLocal } from "./dateUtils.js";

/**
 * CR-040: a video the venue box made for Google Drive but couldn't send there
 * (the court had no usable Drive, or Drive refused it) — and that the box still
 * holds. Needs alias `sv`; one `?`: now.
 */
export const RESEND_FROM_BOX = `sv.delivery = 'Drive' AND sv.status = 'Ready'
  AND sv.driveStatus IN ('Skipped', 'Failed') AND sv.boxDeletedAt IS NULL
  AND (sv.boxKeepUntil IS NULL OR sv.boxKeepUntil > ?)`;

/**
 * Give such videos back to their box as jobs again: it still has the file and
 * sends it to Drive (it stays that box's — no other box has it). Their games go
 * back to Processing until it's done, as an Admin retry does.
 *
 * @param {(sql: string, params: any[]) => Promise<any>} run - `conn.execute` (in a
 *   transaction; returns [result]) or `db.query` (returns the result)
 * @param {{ courtId?: string, sessionId?: string, camera?: number }} where
 * @returns {Promise<number>} how many videos were queued again
 */
export const resendFromBox = async (run, { courtId = null, sessionId = null, camera = null } = {}) => {
  const now = getCurrentTimestampLocal();
  const filters = [];
  const params = [now];
  if (courtId) {
    filters.push("s.courtId = ?");
    params.push(courtId);
  }
  if (sessionId) {
    filters.push("sv.sessionId = ?");
    params.push(sessionId);
  }
  if (camera !== null && camera !== undefined) {
    filters.push("sv.camera = ? AND sv.captureId IS NULL");
    params.push(camera);
  }
  const where = `${RESEND_FROM_BOX} AND s.status != 'Cancelled'${filters.map((f) => ` AND ${f}`).join("")}`;

  const selected = await run(
    `SELECT DISTINCT sv.sessionId FROM session_videos sv
     JOIN recording_sessions s ON s.sessionId = sv.sessionId
     WHERE ${where}`,
    params
  );
  const sessions = (Array.isArray(selected[0]) ? selected[0] : selected).map((row) => row.sessionId);
  if (sessions.length === 0) return 0;

  const updated = await run(
    `UPDATE session_videos sv JOIN recording_sessions s ON s.sessionId = sv.sessionId
     SET sv.status = 'Pending', sv.driveStatus = NULL, sv.driveError = NULL,
         sv.driveSessionUrl = NULL, sv.driveSessionAt = NULL, sv.receivedBytes = 0,
         sv.attempts = 0, sv.nextAttemptAt = NULL, sv.dateUpdated = ?
     WHERE ${where}`,
    [now, ...params]
  );
  await run(
    `UPDATE recording_sessions SET status = 'Processing', wholeVideo = 'Pending', dateUpdated = ?
     WHERE sessionId IN (${sessions.map(() => "?").join(", ")}) AND status IN ('Ready', 'Failed')`,
    [now, ...sessions]
  );
  const result = Array.isArray(updated) ? updated[0] : updated;
  return result.affectedRows || 0;
};
