/**
 * Local smoke test — no API, no real camera. ~2 minutes.
 *
 *   npm run smoke                        # ENCODER=auto
 *   npm run smoke -- --encoder libx264   # force an encoder
 *   npm run smoke -- --keep              # keep the temp folder to look at the files
 *   npm run smoke -- --bursty            # feed the camera in ~1 s bursts (bad Wi-Fi)
 *
 * 1. Makes a fake Tapo-like "camera" file: H.264 High 1280x720@30 with
 *    keyframes at irregular intervals (2.1 s … 6.1 s) + G.711 A-law 8 kHz audio.
 * 2. Plays it in real time into the REAL CourtRecorder (only the RTSP input
 *    options are swapped for a pipe), so segments, segments.csv, index.json and
 *    the wall-clock stamping are the production ones.
 * 3. Cuts a 65 s clip with makeClip() + a PNG logo and checks the result:
 *    duration ≈ 65 s, H.264 video + AAC audio, moov before mdat (faststart),
 *    JPEG thumbnail.
 * 4. Camera setup: reads the camera's details and a preview JPEG from the
 *    latest closed segment (no camera connection).
 * 5. Cuts a 60 s session part (exact window, capped bitrate) from the same buffer.
 * 6. Live view: 25 s in, the LAN live server serves the court's buffer as
 *    HLS; ffprobe plays the signed playlist URL and the video clock must run
 *    on across segments (each file restarts at 0 on disk), a bad signature 403s.
 *    Then a player's own stream (restream.js) copies that live view to a local
 *    RTMP listener: it must report "live" and the listener must get H.264.
 * 7. Meanwhile (skip with --no-stream) a second recorder records AND streams to
 *    a local ffmpeg RTMP server through the tee muxer: segments keep coming,
 *    the receiver gets video, killing the receiver leaves the recording running
 *    and reports a stream error, and a new receiver is picked up again.
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MediaProbe, PreviewSender } from "../src/camera.js";
import { detectEncoder, makeClip } from "../src/clipper.js";
import { probeFile, runFfmpeg } from "../src/ffmpeg.js";
import { createLiveServer, signLive } from "../src/live.js";
import { createLogger } from "../src/log.js";
import { CourtRecorder } from "../src/recorder.js";
import { SessionStreams } from "../src/restream.js";
import { loadTimeline } from "../src/segments.js";
import { maskStreamUrl } from "../src/stream.js";
import { sleep } from "../src/util.js";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";
const SOURCE_SECONDS = 88;
const log = createLogger("smoke");

const fail = (message) => {
  throw new Error(`SMOKE FAILED: ${message}`);
};

/** Keyframe times like a Tapo C200: mostly ~2 s, sometimes 6 s. */
function keyframeTimes(total) {
  const pattern = [2.1, 2.05, 2.1, 6.1, 2.2, 1.7, 2.1, 2.0];
  const times = [0];
  for (let i = 0; times.at(-1) < total; i += 1)
    times.push(+(times.at(-1) + pattern[i % pattern.length]).toFixed(2));
  return times.join(",");
}

async function makeCamera(dir) {
  const file = path.join(dir, "camera.mkv");
  await runFfmpeg(FFMPEG, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=1280x720:rate=30",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=880:sample_rate=8000",
    "-t",
    String(SOURCE_SECONDS),
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-pix_fmt",
    "yuv420p",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-profile:v",
    "high",
    "-bf",
    "0",
    "-g",
    "1000",
    "-sc_threshold",
    "0",
    "-force_key_frames",
    keyframeTimes(SOURCE_SECONDS),
    "-c:a",
    "pcm_alaw",
    "-ac",
    "1",
    file,
  ]);
  const logo = path.join(dir, "logo.png");
  await runFfmpeg(FFMPEG, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=0xFF6600@0.85:s=400x160,format=rgba",
    "-frames:v",
    "1",
    logo,
  ]);
  return { file, logo };
}

const inputFormat = () => (flag("--bursty") ? "matroska" : "nut");

/**
 * spawn() stand-in for the recorder: same arguments, except the RTSP-only
 * input options are dropped and the input is a real-time pipe from the file.
 */
function pipedSpawn(cameraFile, format = inputFormat()) {
  return (bin, args) => {
    const out = [];
    for (let i = 0; i < args.length; i += 1) {
      if (args[i] === "-rtsp_transport" || args[i] === "-timeout" || args[i] === "-stimeout") {
        i += 1;
      } else if (args[i] === "-i") {
        out.push("-f", format, "-i", "pipe:0");
        i += 1;
      } else {
        out.push(args[i]);
      }
    }
    // NUT hands each packet over as it is paced out, like RTP does; --bursty
    // uses MKV clusters instead (packets arrive in ~1 s bursts, like bad Wi-Fi)
    const producer = spawn(
      FFMPEG,
      ["-hide_banner", "-loglevel", "error", "-re", "-i", cameraFile, "-c", "copy"].concat([
        "-flush_packets",
        "1",
        "-f",
        format,
        "pipe:1",
      ]),
      { stdio: ["ignore", "pipe", "inherit"] }
    );
    const recorder = spawn(bin, out, { stdio: ["pipe", "ignore", "pipe"] });
    producer.stdout.pipe(recorder.stdin);
    recorder.stdin.on("error", () => {});
    recorder.on("close", () => producer.kill("SIGKILL"));
    return recorder;
  };
}

/** Top-level MP4 boxes in order (to check moov comes before mdat). */
async function topLevelBoxes(file) {
  const handle = await fs.open(file, "r");
  const boxes = [];
  try {
    const { size } = await handle.stat();
    let offset = 0;
    const header = Buffer.alloc(16);
    while (offset < size && boxes.length < 20) {
      await handle.read(header, 0, 16, offset);
      let boxSize = header.readUInt32BE(0);
      const type = header.toString("latin1", 4, 8);
      if (boxSize === 1) boxSize = Number(header.readBigUInt64BE(8));
      if (boxSize < 8) break;
      boxes.push(type);
      offset += boxSize;
    }
  } finally {
    await handle.close();
  }
  return boxes;
}

/** The pass/fail rules for the finished clip. */
function check({ info, video, audio, boxes, frames, videoStart, thumb }) {
  if (Math.abs(info.duration - 65) > 1.5) fail(`duration ${info.duration}s, expected ≈ 65s`);
  if (video?.codec !== "h264" || video.width !== 1280 || video.height !== 720)
    fail(`video stream ${JSON.stringify(video)}`);
  if (audio?.codec !== "aac")
    fail(`audio stream ${JSON.stringify(audio)} — the camera's A-law audio did not survive`);
  if (boxes.indexOf("moov") === -1 || boxes.indexOf("moov") > boxes.indexOf("mdat"))
    fail("moov is not before mdat (no faststart)");
  // The fake camera runs at 30 fps: a smooth clip keeps (nearly) every frame
  if (frames < 65 * 30 * 0.95)
    fail(`only ${frames} video frames — frames were dropped (choppy clip)`);
  if (videoStart > 0.2) fail(`video starts ${videoStart}s into the clip`);
  if (!thumb || thumb[0] !== 0xff || thumb[1] !== 0xd8 || thumb[2] !== 0xff)
    fail("thumbnail is not a JPEG");
}

const RTMP_URL = "rtmp://127.0.0.1:19350/live/smoke-key-9876";

/** ffmpeg as a one-shot RTMP server, writing what it receives to an MPEG-TS file. */
const rtmpReceiver = (file, rtmpUrl = RTMP_URL) =>
  spawn(
    FFMPEG,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-listen",
      "1",
      "-i",
      rtmpUrl,
      "-c",
      "copy",
      "-f",
      "mpegts",
      file,
    ],
    {
      stdio: ["ignore", "ignore", "ignore"],
    }
  );

const countSegments = async (dir) =>
  (await fs.readdir(dir).catch(() => [])).filter((n) => /^\d+\.ts$/.test(n)).length;

/** Phase 5: record + stream from ONE recorder process; the stream can fail without hurting the recording. */
async function streamPhase({ dir, file, settings }) {
  const bufferDir = path.join(dir, "buffer", "court-stream");
  const recvFile = path.join(dir, "received.ts");
  const recvFile2 = path.join(dir, "received-2.ts");
  let receiver = rtmpReceiver(recvFile);
  await sleep(1000);
  const recorder = new CourtRecorder({
    court: {
      courtId: "court-stream",
      name: "Stream court",
      cameraRtspUrl: "rtsp://smoke:secret@127.0.0.1/stream1",
      stream: { rtmpUrl: RTMP_URL },
    },
    dir: bufferDir,
    settings,
    ffmpegMajor: 99,
    log: createLogger("stream-recorder"),
    // MKV input: NUT tags H.264 with a fourcc that FLV refuses (RTSP sets none)
    spawnImpl: pipedSpawn(file, "matroska"),
  });
  const tickFor = async (ms) => {
    for (const end = Date.now() + ms; Date.now() < end;) {
      await sleep(1000);
      await recorder.tick();
    }
  };
  const results = [];
  try {
    recorder.start();
    await tickFor(12_000);
    const live = recorder.status();
    const before = await countSegments(bufferDir);
    receiver.kill("SIGKILL");
    await tickFor(8_000);
    const dead = recorder.status();
    const during = await countSegments(bufferDir);
    receiver = rtmpReceiver(recvFile2);
    await tickFor(16_000);
    const back = recorder.status();
    const afterCount = await countSegments(bufferDir);
    receiver.kill("SIGKILL");
    await recorder.stop();
    const got = await probeFile(FFPROBE, recvFile).catch(() => ({ duration: 0, streams: [] }));
    const got2 = await probeFile(FFPROBE, recvFile2).catch(() => ({ duration: 0, streams: [] }));
    results.push(
      `stream to ${maskStreamUrl(RTMP_URL)} — after 12 s: recording ${live.status}, stream ${live.streamStatus}`,
      `receiver 1 got ${got.streams.map((s) => s.codec).join("+") || "nothing"}, ${got.duration.toFixed(1)}s`,
      `receiver killed → stream ${dead.streamStatus} ("${dead.streamMessage}"), recording ${dead.status}, segments ${before} → ${during}`,
      `new receiver → stream ${back.streamStatus}, recording ${back.status}, segments → ${afterCount}; receiver 2 got ${got2.streams.map((s) => s.codec).join("+") || "nothing"}, ${got2.duration.toFixed(1)}s`
    );
    if (live.status !== "ok" || live.streamStatus !== "live")
      fail(`stream did not go live: ${JSON.stringify(live)}`);
    if (!got.streams.some((s) => s.codec === "h264") || got.duration < 5)
      fail("the RTMP receiver got no video");
    if (dead.status !== "ok" || dead.streamStatus !== "error")
      fail(`after the receiver died: ${JSON.stringify(dead)}`);
    if (during <= before || afterCount <= during)
      fail("segments stopped while the stream was down");
    if (back.streamStatus !== "live" || !got2.streams.some((s) => s.codec === "h264"))
      fail("the stream did not reconnect");
    return results;
  } finally {
    receiver.kill("SIGKILL");
    await recorder.stop();
  }
}

/** Phase 6: the LAN live view over the court-smoke buffer, read by ffprobe like a player. */
async function livePhase({ bufferRoot }) {
  await sleep(25_000);
  const key = "5".repeat(64);
  const server = createLiveServer({ bufferDir: bufferRoot, key, log: createLogger("live") });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const exp = Math.floor(Date.now() / 1000) + 300;
    const base = `http://127.0.0.1:${server.address().port}/live/court-smoke/index.m3u8`;
    const url = `${base}?exp=${exp}&sig=${signLive(key, "court-smoke", exp)}`;
    const first = await (await fetch(url)).text();
    const bad = await fetch(`${base}?exp=${exp}&sig=${"0".repeat(64)}`);
    const segments = first.split("\n").filter((l) => l.startsWith("#EXTINF")).length;
    if (segments !== 5 || first.includes("#EXT-X-ENDLIST")) fail(`live playlist:\n${first}`);
    if (bad.status !== 403) fail(`a bad live signature answered ${bad.status}`);
    // ffmpeg's HLS reader only accepts segment URIs ending in .ts unless extension_picky is off
    const { stdout } = await runFfmpeg(FFPROBE, [
      "-v",
      "error",
      "-extension_picky",
      "0",
      "-live_start_index",
      "0",
      "-read_intervals",
      "%+7",
      "-show_entries",
      "packet=codec_type,pts_time",
      "-of",
      "csv=p=0",
      url,
    ]);
    const packets = stdout
      .trim()
      .split("\n")
      .map((l) => l.split(","));
    const video = packets.filter(([type]) => type === "video").map(([, pts]) => Number(pts));
    const backwards = video.filter((pts, i) => i > 0 && pts <= video[i - 1]).length;
    const span = video.at(-1) - video[0];
    const audio = packets.filter(([type]) => type === "audio").length;
    const sequence = (text) => Number(/#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec(text)?.[1]);
    await sleep(5000);
    const second = await (await fetch(url)).text();
    const result =
      `live view: ${segments} segments, sequence ${sequence(first)} → ${sequence(second)} after 5 s; ` +
      `ffprobe read ${video.length} video packets over ${span.toFixed(2)}s (${backwards} going back), ${audio} audio packets`;
    if (video.length < 150 || span < 5) fail(`ffprobe could not play the live view — ${result}`);
    if (backwards) fail(`the live clock jumps back between segments — ${result}`);
    if (!audio) fail(`no audio in the live view — ${result}`);
    if (!(sequence(second) > sequence(first))) fail(`media sequence did not move on — ${result}`);
    log.info(result);
    await playerStreamPhase({
      port: server.address().port,
      key,
      workDir: path.dirname(bufferRoot),
    });
  } finally {
    server.close();
  }
}

/** Phase 6b: a player's own stream — its own ffmpeg copies the live view to RTMP (here a local listener). */
async function playerStreamPhase({ port, key, workDir }) {
  const playerUrl = "rtmp://127.0.0.1:19351/live/player-key-4321";
  const received = path.join(workDir, "player-received.ts");
  const receiver = rtmpReceiver(received, playerUrl);
  await sleep(1000);
  const live = {
    settings: { livePort: port },
    localPlaylistUrl: (courtId, exp) =>
      `http://127.0.0.1:${port}/live/${courtId}/index.m3u8?exp=${exp}&sig=${signLive(key, courtId, exp)}`,
  };
  const streams = new SessionStreams({
    live,
    records: () => true,
    ffmpegPath: FFMPEG,
    log: createLogger("player-stream"),
  });
  const now = Date.now();
  streams.setSessions([
    {
      sessionId: "smoke-session",
      courtId: "court-smoke",
      startMs: now - 1000,
      endMs: now + 600_000,
      stream: { url: playerUrl },
    },
  ]);
  let status;
  try {
    for (let i = 0; i < 25 && status?.status !== "live"; i += 1) {
      await streams.tick();
      status = streams.statuses()[0];
      await sleep(1000);
    }
    await sleep(3000);
  } finally {
    await streams.stopAll();
    await sleep(1000);
    receiver.kill("SIGKILL");
  }
  const got = await probeFile(FFPROBE, received).catch(() => ({ duration: 0, streams: [] }));
  const codecs = got.streams.map((s) => s.codec).join("+") || "nothing";
  const result = `player stream: ${status?.status} ("${status?.message}"); the listener got ${codecs}, ${got.duration.toFixed(1)}s`;
  if (status?.status !== "live") fail(`the player stream did not go live — ${result}`);
  if (!got.streams.some((s) => s.codec === "h264") || got.duration < 4) {
    fail(`the player stream sent no video — ${result}`);
  }
  log.info(result);
}

/** Phase 4: camera details + a preview JPEG, read from the buffer (never from the camera). */
async function cameraSetupPhase({ dir, bufferDir, settings }) {
  const media = await new MediaProbe({ ffprobePath: FFPROBE }).refresh(bufferDir);
  const kept = path.join(dir, "preview-uploaded.jpg");
  const sender = new PreviewSender({
    api: { uploadSnapshot: (_courtId, file) => fs.copyFile(file, kept) },
    courtDir: () => bufferDir,
    settings,
    log: createLogger("preview"),
  });
  sender.setWanted([{ courtId: "court-smoke", previewWanted: true }]);
  const sent = await sender.tick();
  const jpeg = await fs.readFile(kept).catch(() => null);
  const picture = jpeg ? (await probeFile(FFPROBE, kept)).streams[0] : null;
  console.log(
    `camera details: ${JSON.stringify({ video: media?.video, audio: media?.audio })}\n` +
      `preview: sent for ${JSON.stringify(sent)}, ${jpeg ? `${jpeg.length} bytes, ${picture.codec} ${picture.width}x${picture.height}` : "none"}`
  );
  const v = media?.video;
  if (v?.codec !== "h264" || v.width !== 1280 || v.height !== 720 || Math.abs(v.fps - 30) > 1) {
    fail(`camera details ${JSON.stringify(media)}`);
  }
  if (media.audio?.codec !== "aac" || media.audio.sampleRate !== 8000)
    fail(`audio ${JSON.stringify(media.audio)}`);
  if (!jpeg || jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || picture.width > 1280)
    fail("no JPEG preview");
}

/** A session part: exactly [20 s, 80 s] of the recording, with the capped session bitrate. */
async function cutSessionPart({ dir, bufferDir, startedAt, logo, encoder, settings }) {
  const part = await makeClip(
    {
      clipId: "smoke-part",
      courtId: "court-smoke",
      requestedAtMs: startedAt + 80_000,
      windowStartMs: startedAt + 20_000,
      windowEndMs: startedAt + 80_000,
    },
    {
      segmentsDir: bufferDir,
      courtKnown: true,
      workDir: path.join(dir, "jobs", "smoke-part"),
      logoPath: logo,
      encoder,
      settings,
      log: createLogger("clip"),
    }
  );
  if (part.status !== "done") fail(`session part not made: ${JSON.stringify(part)}`);
  const partInfo = await probeFile(FFPROBE, part.videoPath);
  const { size } = await fs.stat(part.videoPath);
  const kbps = Math.round((size * 8) / partInfo.duration / 1000);
  console.log(
    `\nsession part: ${partInfo.duration.toFixed(3)}s, ${partInfo.streams.map((s) => s.codec).join("+")}, ` +
      `${size} bytes (${kbps} kb/s), coverage ${(part.coverage * 100).toFixed(1)}%\n`
  );
  if (Math.abs(partInfo.duration - 60) > 1)
    fail(`part duration ${partInfo.duration}s, expected 60s`);
  if (!partInfo.streams.some((s) => s.codec === "aac")) fail("part has no AAC audio");
  if (kbps > 1400) fail(`part bitrate ${kbps} kb/s is over the session cap`);
  return { ...partInfo, kbps };
}

/** The main court's recorder, fed in real time from the fake camera file. */
const smokeRecorder = ({ bufferDir, file, settings }) =>
  new CourtRecorder({
    court: {
      courtId: "court-smoke",
      name: "Smoke court",
      cameraRtspUrl: "rtsp://smoke:secret@127.0.0.1/stream1",
    },
    dir: bufferDir,
    settings,
    ffmpegMajor: 99,
    log: createLogger("recorder"),
    spawnImpl: pipedSpawn(file),
  });

async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dyna-cam-smoke-"));
  const settings = {
    segmentSeconds: 2,
    bufferSeconds: 180,
    recordAudio: true,
    ffmpegPath: FFMPEG,
    ffprobePath: FFPROBE,
    vaapiDevice: "/dev/dri/renderD128",
  };
  let recorder;
  try {
    log.info(`working in ${dir}`);
    const { file, logo } = await makeCamera(dir);
    const encoder = await detectEncoder({
      ffmpegPath: FFMPEG,
      preferred: option("--encoder", "auto"),
      log,
    });
    log.info(`fake camera ready (${SOURCE_SECONDS}s, pcm_alaw audio); clip encoder: ${encoder}`);

    const streaming = flag("--no-stream")
      ? Promise.resolve(null)
      : streamPhase({ dir, file, settings }).catch((err) => err);
    const bufferDir = path.join(dir, "buffer", "court-smoke");
    recorder = smokeRecorder({ bufferDir, file, settings });
    const startedAt = Date.now();
    recorder.start();
    const liveView = livePhase({ bufferRoot: path.dirname(bufferDir) }).then(
      () => null,
      (e) => e
    );

    // A player saves a replay 75 s into the recording: window = [15 s, 80 s]
    const entry = {
      clipId: "smoke-clip",
      courtId: "court-smoke",
      requestedAtMs: startedAt + 75_000,
      preSeconds: 60,
      postSeconds: 5,
    };
    let result;
    let lastStatus = "";
    while (!result || result.status === "wait") {
      await sleep(2000);
      await recorder.tick();
      const status = recorder.status();
      if (status.status !== lastStatus)
        log.info(`recorder status: ${status.status} — ${status.message}`);
      lastStatus = status.status;
      if (Date.now() - startedAt > (SOURCE_SECONDS + 40) * 1000)
        fail("timed out waiting for the window");
      result = await makeClip(entry, {
        segmentsDir: bufferDir,
        courtKnown: true,
        workDir: path.join(dir, "jobs", "smoke-clip"),
        logoPath: logo,
        encoder,
        settings,
        log: createLogger("clip"),
      });
    }
    const cutStartedAfter = ((Date.now() - startedAt) / 1000).toFixed(1);
    const liveError = await liveView; // the finally block stops the recorder
    if (liveError) throw liveError;
    await recorder.stop();
    if (result.status !== "done") fail(`clip not made: ${JSON.stringify(result)}`);

    const timeline = await loadTimeline(bufferDir, { ffprobePath: FFPROBE });
    const lengths = timeline.map((s) => (s.endMs - s.startMs) / 1000);
    log.info(
      `buffer: ${timeline.length} closed segments, ${timeline.filter((s) => s.exact).length} timed from segments.csv, ` +
        `lengths ${Math.min(...lengths).toFixed(2)}–${Math.max(...lengths).toFixed(2)}s; clip ready ${cutStartedAfter}s after recording started`
    );

    const info = await probeFile(FFPROBE, result.videoPath);
    const { stdout } = await runFfmpeg(FFPROBE, [
      "-v",
      "error",
      "-show_entries",
      "format=duration,size,bit_rate:stream=codec_name,codec_type,width,height,sample_rate,start_time,nb_frames,avg_frame_rate",
      "-of",
      "compact",
      result.videoPath,
    ]);
    console.log(`\nffprobe ${path.basename(result.videoPath)}:\n${stdout.trim()}`);
    const videoLine = stdout.split("\n").find((l) => l.includes("codec_type=video")) || "";
    const frames = Number(/nb_frames=(\d+)/.exec(videoLine)?.[1] || 0);
    const videoStart = Number(/start_time=([\d.]+)/.exec(videoLine)?.[1] || 0);
    const boxes = await topLevelBoxes(result.videoPath);
    console.log(`top-level boxes: ${boxes.join(" → ")}`);
    const video = info.streams.find((s) => s.type === "video");
    const audio = info.streams.find((s) => s.type === "audio");
    const thumb = result.thumbnailPath ? await fs.readFile(result.thumbnailPath) : null;
    console.log(
      `thumbnail: ${thumb ? `${thumb.length} bytes, magic ${thumb.subarray(0, 3).toString("hex")}` : "none"}\n`
    );

    check({ info, video, audio, boxes, frames, videoStart, thumb });
    if (recorder.lastStderr && !/^$/.test(recorder.lastStderr))
      log.info(`recorder's last stderr line: ${recorder.lastStderr}`);
    log.info(
      `clip OK — ${info.duration.toFixed(2)}s with ${result.encoder}, AAC audio, faststart, JPEG thumbnail`
    );

    await cameraSetupPhase({ dir, bufferDir, settings });
    const partInfo = await cutSessionPart({ dir, bufferDir, startedAt, logo, encoder, settings });
    const { kbps } = partInfo;
    const streamResult = await streaming;
    if (streamResult instanceof Error) throw streamResult;
    if (streamResult) console.log(`\n${streamResult.join("\n")}\n`);
    log.info(
      `SMOKE OK — clip ${info.duration.toFixed(2)}s, session part ${partInfo.duration.toFixed(2)}s at ${kbps} kb/s`
    );
  } finally {
    await recorder?.stop();
    if (flag("--keep")) log.info(`kept ${dir}`);
    else await fs.rm(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
