import { logger } from "../../config/logger.js";
import { daysFromNowLocal } from "../utils/clips.js";
import { getCurrentTimestampLocal, moment } from "../utils/dateUtils.js";
import { removeClipFiles } from "../utils/file/clipFiles.js";
import { ffmpegAvailable, gapsOf, joinParts } from "../utils/sessionVideos.js";

/**
 * Whole-game videos (CR-003), every 20 s.
 *
 * 1. A game that has settled (every part made or given up) gets a
 *    session_videos row per camera that has footage — or is Skipped when no
 *    part could be saved.
 * 2. Each Pending video is claimed (a lease, like jobs/driveUploads.js), its
 *    camera's Ready parts are joined into one file (utils/sessionVideos.js),
 *    the part files are deleted and the parts marked joined. A court with a
 *    Google account gets the whole video in its Drive (jobs/driveUploads.js).
 * 3. A join that fails is retried twice, then Failed with the reason; staff
 *    can try again from Admin → Sessions. The parts stay until it works.
 *
 * Without ffmpeg only one-part games are joined (a copy); the rest wait, and
 * the player's page keeps showing the parts.
 */

const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";
const FORMAT = "YYYY-MM-DD HH:mm:ss";
const LEASE_MINUTES = 30;
export const JOIN_MAX_ATTEMPTS = 3;
const RETRY_MINUTES = [2, 10];
const BATCH = 2;

const minutesFromNow = (minutes) => moment().tz(TIMEZONE).add(minutes, "minutes").format(FORMAT);

/** Give every settled game its whole-video rows. */
const createVideos = async (db) => {
  const sessions = await db.query(
    `SELECT sessionId, venueId, status FROM recording_sessions
     WHERE status IN ('Ready', 'Failed') AND wholeVideo IS NULL
     LIMIT 20`
  );
  const now = getCurrentTimestampLocal();
  for (const session of sessions) {
    const cameras = await db.query(
      `SELECT camera FROM clips
       WHERE sessionId = ? AND status = 'Ready' AND videoPath IS NOT NULL AND joinedAt IS NULL
       GROUP BY camera ORDER BY camera`,
      [session.sessionId]
    );
    for (const { camera } of cameras) {
      const [{ id }] = await db.query(`SELECT UUID() AS id`);
      await db.query(
        `INSERT IGNORE INTO session_videos
           (sessionVideoId, sessionId, venueId, camera, status, dateCreated, dateUpdated)
         VALUES (?, ?, ?, ?, 'Pending', ?, ?)`,
        [id, session.sessionId, session.venueId, camera, now, now]
      );
    }
    await db.query(
      `UPDATE recording_sessions SET wholeVideo = ? WHERE sessionId = ? AND wholeVideo IS NULL`,
      [cameras.length > 0 ? "Pending" : "Skipped", session.sessionId]
    );
  }
};

/** A session whose whole videos are all settled is Done. */
const finishSessions = (db) =>
  db.query(
    `UPDATE recording_sessions s
     SET s.wholeVideo = 'Done'
     WHERE s.wholeVideo = 'Pending'
       AND NOT EXISTS (
         SELECT 1 FROM session_videos sv
         WHERE sv.sessionId = s.sessionId AND sv.status IN ('Pending', 'Joining')
       )`
  );

/**
 * Join one claimed video.
 * @returns {Promise<"joined"|"waiting"|"retry"|"failed">}
 */
const joinVideo = async (db, video, canJoinMany) => {
  const parts = await db.query(
    `SELECT clipId, partIndex, status, videoPath, thumbnailPath, durationSeconds,
            windowStartAt, windowEndAt
     FROM clips
     WHERE sessionId = ? AND camera = ? AND status != 'Deleted' AND joinedAt IS NULL
     ORDER BY partIndex ASC`,
    [video.sessionId, video.camera]
  );
  const ready = parts.filter((part) => part.status === "Ready" && part.videoPath);

  const release = (fields) => {
    const columns = Object.keys(fields);
    return db.query(
      `UPDATE session_videos SET ${columns.map((column) => `${column} = ?`).join(", ")},
              dateUpdated = ?
       WHERE sessionVideoId = ? AND status = 'Joining'`,
      [...columns.map((column) => fields[column]), getCurrentTimestampLocal(), video.sessionVideoId]
    );
  };

  if (ready.length === 0) {
    await release({ status: "Failed", failureReason: "No part of this camera could be saved" });
    return "failed";
  }
  if (ready.length > 1 && !canJoinMany) {
    // No ffmpeg on this server: leave it waiting (the page shows the parts)
    await release({ status: "Pending", nextAttemptAt: minutesFromNow(10) });
    return "waiting";
  }

  try {
    const joined = await joinParts(video, ready);
    const gaps = gapsOf(parts);
    const now = getCurrentTimestampLocal();
    await release({
      status: "Ready",
      videoPath: joined.videoPath,
      thumbnailPath: joined.thumbnailPath,
      sizeBytes: joined.sizeBytes,
      durationSeconds: ready.reduce((sum, part) => sum + (part.durationSeconds || 0), 0),
      partsJoined: ready.length,
      partsMissing: parts.length - ready.length,
      gaps: JSON.stringify(gaps),
      failureReason: null,
      nextAttemptAt: null,
      expiresAt: daysFromNowLocal(video.clipRetentionDays),
    });

    // The parts are in the whole video now: free their files
    const ids = ready.map((part) => part.clipId);
    await db.query(
      `UPDATE clips SET joinedAt = ?, videoPath = NULL, thumbnailPath = NULL, dateUpdated = ?
       WHERE clipId IN (${ids.map(() => "?").join(", ")})`,
      [now, now, ...ids]
    );
    await removeClipFiles(...ready.flatMap((part) => [part.videoPath, part.thumbnailPath]));

    // CR-001: a court with a Google account gets the whole video in its Drive
    await db.query(
      `UPDATE session_videos sv
       JOIN recording_sessions s ON s.sessionId = sv.sessionId
       JOIN courts c ON c.courtId = s.courtId
       SET sv.driveStatus = 'Pending', sv.driveAttempts = 0, sv.driveNextAttemptAt = NULL
       WHERE sv.sessionVideoId = ? AND sv.driveStatus IS NULL
         AND c.driveRefreshToken IS NOT NULL AND c.status != 'Deleted'`,
      [video.sessionVideoId]
    );
    return "joined";
  } catch (err) {
    const attempts = (video.attempts || 0) + 1;
    const giveUp = attempts >= JOIN_MAX_ATTEMPTS;
    await release({
      status: giveUp ? "Failed" : "Pending",
      attempts,
      failureReason: String(err.message || "Joining failed").slice(0, 255),
      nextAttemptAt: giveUp ? null : minutesFromNow(RETRY_MINUTES[attempts - 1] || 10),
    });
    logger.warn("Whole-game video join failed", {
      sessionVideoId: video.sessionVideoId,
      attempts,
      error: err.message,
    });
    return giveUp ? "failed" : "retry";
  }
};

/**
 * One pass.
 * @param {import("../../config/database.js").default} db
 * @returns {Promise<Record<string, number>>} how each video ended
 */
export const runSessionJoins = async (db, { limit = BATCH } = {}) => {
  const tally = {};
  await createVideos(db);

  const now = getCurrentTimestampLocal();
  // A join cut off by a restart: its lease ran out
  await db.query(
    `UPDATE session_videos SET status = 'Pending'
     WHERE status = 'Joining' AND nextAttemptAt <= ?`,
    [now]
  );

  const due = await db.query(
    `SELECT sv.sessionVideoId, sv.sessionId, sv.venueId, sv.camera, sv.attempts,
            v.clipRetentionDays
     FROM session_videos sv
     JOIN venues v ON v.venueId = sv.venueId
     WHERE sv.status = 'Pending' AND (sv.nextAttemptAt IS NULL OR sv.nextAttemptAt <= ?)
     ORDER BY sv.dateCreated ASC
     LIMIT ${Math.max(1, Math.min(20, Number(limit) || BATCH))}`,
    [now]
  );

  const canJoinMany = due.length > 0 ? await ffmpegAvailable() : true;
  for (const video of due) {
    const claimed = await db.query(
      `UPDATE session_videos SET status = 'Joining', nextAttemptAt = ?
       WHERE sessionVideoId = ? AND status = 'Pending'`,
      [minutesFromNow(LEASE_MINUTES), video.sessionVideoId]
    );
    if (!claimed.affectedRows) continue;
    const result = await joinVideo(db, video, canJoinMany);
    tally[result] = (tally[result] || 0) + 1;
  }

  await finishSessions(db);
  return tally;
};

const INTERVAL_MS = 20 * 1000;

/**
 * Run every `intervalMs`, one pass at a time. Returns a function that stops it.
 * @param {import("../../config/database.js").default} db
 */
export const scheduleSessionJoins = (db, intervalMs = INTERVAL_MS) => {
  let running = false;
  let warned = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      if (!warned && !(await ffmpegAvailable())) {
        warned = true;
        logger.warn(
          "ffmpeg not found — whole-game videos of more than one part can't be joined " +
            "(install ffmpeg, or set FFMPEG_PATH)"
        );
      }
      const tally = await runSessionJoins(db);
      if (Object.keys(tally).length > 0) logger.info("Whole-game videos", tally);
    } catch (err) {
      logger.error("Whole-game videos failed", { error: err.message });
    } finally {
      running = false;
    }
  };
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref(); // never keep the process alive just for this
  return () => clearInterval(timer);
};
