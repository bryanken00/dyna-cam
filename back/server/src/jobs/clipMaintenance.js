import { logger } from "../../config/logger.js";
import { CLIP_STALE_MINUTES, secondsAgoLocal, SESSION_PART_STALE_MINUTES } from "../utils/clips.js";
import { getCurrentTimestampLocal } from "../utils/dateUtils.js";
import { removeClipFiles } from "../utils/file/clipFiles.js";
import { materializeSessionParts, settleSessions } from "../utils/sessions.js";

/**
 * Clip housekeeping (PLAN-001), run at startup and then every hour:
 *
 * 1. Expire: a Ready clip past its `expiresAt` (the venue's retention days)
 *    becomes Expired and its files are deleted. The row stays (soft), so the
 *    share link says "expired" instead of "not found".
 * 2. Give up: a clip still Pending/Processing after CLIP_STALE_MINUTES (a
 *    session part: SESSION_PART_STALE_MINUTES) is marked Failed — the recorder
 *    box never answered, and its footage is gone by then anyway.
 *
 * @param {import("../../config/database.js").default} db
 * @returns {Promise<{ expired: number, failed: number }>}
 */
export const runClipMaintenance = async (db) => {
  // Sessions whose box never polled still get their parts (which then fail
  // below if nobody cuts them), so no session is left hanging
  await materializeSessionParts(db);

  const now = getCurrentTimestampLocal();

  const due = await db.query(
    `SELECT clipId, videoPath, thumbnailPath FROM clips
     WHERE status = 'Ready' AND expiresAt IS NOT NULL AND expiresAt <= ?
     LIMIT 500`,
    [now]
  );

  let expired = 0;
  for (const clip of due) {
    // Flip the row first: once it is Expired no link is signed for it, so
    // deleting the files after can never break a page mid-view.
    const result = await db.query(
      `UPDATE clips SET status = 'Expired', videoPath = NULL, thumbnailPath = NULL,
                        dateUpdated = ?
       WHERE clipId = ? AND status = 'Ready'`,
      [now, clip.clipId]
    );
    if (result.affectedRows > 0) {
      await removeClipFiles(clip.videoPath, clip.thumbnailPath);
      expired += 1;
    }
  }

  const stale = await db.query(
    `UPDATE clips
     SET status = 'Failed', failureReason = 'The recorder did not respond in time', dateUpdated = ?
     WHERE status IN ('Pending', 'Processing')
       AND requestedAt < IF(source = 'SESSION', ?, ?)`,
    [
      now,
      secondsAgoLocal(SESSION_PART_STALE_MINUTES * 60),
      secondsAgoLocal(CLIP_STALE_MINUTES * 60),
    ]
  );

  await settleSessions(db);

  return { expired, failed: stale.affectedRows || 0 };
};

const HOUR_MS = 60 * 60 * 1000;

/**
 * Run now, then every `intervalMs`. Returns a function that stops it.
 * @param {import("../../config/database.js").default} db
 */
export const scheduleClipMaintenance = (db, intervalMs = HOUR_MS) => {
  const run = () =>
    runClipMaintenance(db)
      .then(({ expired, failed }) => {
        if (expired || failed) {
          logger.info("Clip maintenance", { expired, failed });
        }
      })
      .catch((err) => logger.error("Clip maintenance failed", { error: err.message }));

  run();
  const timer = setInterval(run, intervalMs);
  timer.unref(); // never keep the process alive just for this
  return () => clearInterval(timer);
};
