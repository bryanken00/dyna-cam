// CR-006 — what the recorder box does after End game: a game job per camera,
// then the whole file in chunks (start → chunk… → finish). For tests.

import { JPEG } from "./testApp.js";

/** The smallest buffer that passes the API's mp4 check (an ISO media "ftyp" box). */
export const GAME_MP4 = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from("ftypisom"),
  Buffer.alloc(200, 7),
]);

/** The box's game jobs (type "game"), optionally for one session, camera order. */
export const gameJobs = async (ctx, deviceToken, sessionId) => {
  const res = await ctx.api("GET", "/device/jobs?wait=0", {
    headers: { Authorization: `Device ${deviceToken}` },
  });
  return (res.data?.jobs || [])
    .filter((job) => job.type === "game" && (!sessionId || job.sessionId === sessionId))
    .sort((a, b) => a.camera - b.camera);
};

/** PUT one chunk of raw bytes. @returns {{ status, body }} */
export const putChunk = async (ctx, deviceToken, sessionVideoId, offset, bytes) => {
  const res = await ctx.get(`/api/v1/device/game-videos/${sessionVideoId}/chunk?offset=${offset}`, {
    method: "PUT",
    headers: {
      Authorization: `Device ${deviceToken}`,
      "Content-Type": "application/octet-stream",
    },
    body: bytes,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

/**
 * Send a whole game file for one game job, in chunks of `chunk` bytes.
 * @returns {Promise<{ status, body }>} the finish response
 */
export const sendGame = async (
  ctx,
  deviceToken,
  sessionVideoId,
  { bytes = GAME_MP4, gaps = [], durationSeconds = 60, chunk = 64, thumbnail = true } = {}
) => {
  const device = { Authorization: `Device ${deviceToken}` };
  const start = await ctx.api("POST", `/device/game-videos/${sessionVideoId}/start`, {
    headers: device,
    body: { sizeBytes: bytes.length, durationSeconds, gaps },
  });
  if (start.status !== 200) return start;
  let offset = start.data.receivedBytes;
  while (offset < bytes.length) {
    const put = await putChunk(
      ctx,
      deviceToken,
      sessionVideoId,
      offset,
      bytes.subarray(offset, offset + chunk)
    );
    if (put.status !== 200) return put;
    offset = put.body.data.receivedBytes;
  }
  return ctx.api("POST", `/device/game-videos/${sessionVideoId}/finish`, {
    headers: device,
    form: thumbnail ? [["thumbnail", JPEG, "image/jpeg", "thumb.jpg"]] : [["note", "no thumbnail"]],
  });
};
