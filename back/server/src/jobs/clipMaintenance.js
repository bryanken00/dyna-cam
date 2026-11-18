import { logger } from "../../config/logger.js";
import { CLIP_STALE_MINUTES, secondsAgoLocal, SESSION_PART_STALE_MINUTES } from "../utils/clips.js";
import { getCurrentTimestampLocal } from "../utils/dateUtils.js";
import fs from "node:fs";
import path from "node:path";
import { clipUploadFolder, removeClipFiles } from "../utils/file/clipFiles.js";
import { materializeSessionParts, settleSessions } from "../utils/sessions.js";

/** CR-006: hours after a game ends before an unsent game video is given up. */
export const GAME_UPLOAD_GIVE_UP_HOURS = Math.max(
  1,
  parseInt(process.env.GAME_UPLOAD_GIVE_UP_HOURS || "24", 10) || 24
);

/**
 * Clip housekeeping (PLAN-001), run at startup and then every hour:
 *
 * 1. Expire: a Ready clip past its `expiresAt` (the venue's retention days)
 *    becomes Expired and its files are deleted. The row stays (soft), so the
 *    share link says "expired" instead of "not found".
 *    Whole-game videos (CR-003) expire the same way.
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

  // CR-003: whole-game videos expire like clips (their Drive copy stays)
  const dueVideos = await db.query(
    `SELECT sessionVideoId, videoPath, thumbnailPath FROM session_videos
     WHERE status = 'Ready' AND expiresAt IS NOT NULL AND expiresAt <= ?
     LIMIT 200`,
    [now]
  );
  for (const video of dueVideos) {
    const result = await db.query(
      `UPDATE session_videos SET status = 'Expired', videoPath = NULL, thumbnailPath = NULL,
                                 dateUpdated = ?
       WHERE sessionVideoId = ? AND status = 'Ready'`,
      [now, video.sessionVideoId]
    );
    if (result.affectedRows > 0) {
      await removeClipFiles(video.videoPath, video.thumbnailPath);
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

  let failed = stale.affectedRows || 0;

  // CR-006: a game video the box never finished sending — give up, so the game
  // settles (Ready with what came in, or Failed) and its footage can go
  const giveUpBefore = secondsAgoLocal(GAME_UPLOAD_GIVE_UP_HOURS * 3600);
  const abandoned = await db.query(
    `SELECT sv.sessionVideoId, sv.venueId FROM session_videos sv
     JOIN recording_sessions s ON s.sessionId = sv.sessionId
     WHERE sv.status IN ('Pending', 'Uploading') AND s.endAt < ?
     LIMIT 200`,
    [giveUpBefore]
  );
  for (const video of abandoned) {
    const result = await db.query(
      `UPDATE session_videos
       SET status = 'Failed', failureReason = 'The recorder box didn''t send this game in time',
           dateUpdated = ?
       WHERE sessionVideoId = ? AND status IN ('Pending', 'Uploading')`,
      [now, video.sessionVideoId]
    );
    if (result.affectedRows > 0) {
      const folder = path.resolve("public", clipUploadFolder(video.venueId, video.sessionVideoId));
      await fs.promises.rm(folder, { recursive: true, force: true }).catch(() => {});
      failed += 1;
    }
  }

  await settleSessions(db);

  return { expired, failed };
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
