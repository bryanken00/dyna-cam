// CR-006 / CR-040 — what the recorder box does after End game: a game job per
// camera, then (CR-040 Phase 4) the file stays on the box and goes straight to
// the court's Google Drive (drive-session → PUT to Google → drive-done). For tests.

import crypto from "node:crypto";

/** The smallest buffer that looks like an mp4 (an ISO media "ftyp" box). */
export const GAME_MP4 = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from("ftypisom"),
  Buffer.alloc(200, 7),
]);

const device = (deviceToken) => ({ Authorization: `Device ${deviceToken}` });

/**
 * CR-040 Phase 4: only a box that reports "drive-direct" gets game jobs. Marks
 * the box so in its stored status (as its heartbeat would), leaving the rest of
 * that status (cameras, live view) alone.
 */
export const markDriveDirect = (ctx, deviceToken) =>
  ctx.sql.query(
    `UPDATE devices
     SET lastStatus = JSON_SET(COALESCE(lastStatus, JSON_OBJECT()), '$.capabilities',
                               JSON_ARRAY('game-file', 'drive-direct'))
     WHERE tokenHash = ?`,
    [crypto.createHash("sha256").update(String(deviceToken)).digest("hex")]
  );

/** The box's game jobs (type "game"), optionally for one session, camera order. */
export const gameJobs = async (ctx, deviceToken, sessionId) => {
  await markDriveDirect(ctx, deviceToken);
  const res = await ctx.api("GET", "/device/jobs?wait=0", { headers: device(deviceToken) });
  return (res.data?.jobs || [])
    .filter((job) => job.type === "game" && (!sessionId || job.sessionId === sessionId))
    .sort((a, b) => a.camera - b.camera);
};

/**
 * The box made the file: POST drive-session. On a court without a usable
 * Google Drive the video is Ready at once and kept on the box only.
 * @returns {Promise<{ status, body, data }>} the drive-session answer
 */
export const keepGame = (
  ctx,
  deviceToken,
  sessionVideoId,
  { bytes = GAME_MP4, gaps = [], durationSeconds = 60, newSession } = {}
) =>
  ctx.api("POST", `/device/game-videos/${sessionVideoId}/drive-session`, {
    headers: device(deviceToken),
    body: {
      sizeBytes: bytes.length,
      durationSeconds,
      gaps,
      ...(newSession === undefined ? {} : { newSession }),
    },
  });

/**
 * The whole box flow to a court with Google Drive (a fakeGoogle in the test):
 * drive-session → the bytes to Google's upload address (no token) → drive-done.
 * @returns {Promise<{ status, body, data }>} the drive-done answer (or the
 *   drive-session answer when it didn't hand out an upload address)
 */
export const sendGameToDrive = async (ctx, deviceToken, sessionVideoId, opts = {}) => {
  const bytes = opts.bytes || GAME_MP4;
  const opened = await keepGame(ctx, deviceToken, sessionVideoId, opts);
  if (opened.status !== 200 || !opened.data?.drive) return opened;
  const put = await fetch(opened.data.uploadUrl, {
    method: "PUT",
    headers: { "Content-Range": `bytes 0-${bytes.length - 1}/${bytes.length}` },
    body: bytes,
  });
  if (![200, 201].includes(put.status)) return { status: put.status, body: null, data: null };
  const { id } = await put.json();
  return ctx.api("POST", `/device/game-videos/${sessionVideoId}/drive-done`, {
    headers: device(deviceToken),
    body: { driveFileId: id },
  });
};
