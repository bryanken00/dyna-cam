import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, it } from "node:test";
import { CourtRecorder, describeFailure, failureKind, restartDelayMs } from "../src/recorder.js";

/**
 * BUG-002: a camera that rejects the sign-in, or has locked itself, is retried
 * in minutes, not seconds — quick retries are what lock a Tapo camera, and keep
 * it locked.
 */

const MIN = 60_000;
const silent = { debug() {}, info() {}, warn() {}, error() {} };
const LOCKED =
  "[in#0 @ 0x1] Error opening input: Server returned 400 Bad Request\nError opening input files: Server returned 400 Bad Request";

describe("failureKind", () => {
  it("tells a refused sign-in and a locked camera from a drop-out", () => {
    assert.equal(failureKind("method DESCRIBE failed: 401 Unauthorized"), "auth");
    assert.equal(
      failureKind("Error opening input files: Server returned 400 Bad Request"),
      "locked"
    );
    assert.equal(failureKind("RTSP/1.0 400 Server is locked"), "locked");
    assert.equal(failureKind("method DESCRIBE failed: 404 Not Found"), "notFound");
    assert.equal(failureKind("Error opening input files: Operation timed out"), "unreachable");
    assert.equal(failureKind("Error opening input files: Connection refused"), "unreachable");
    assert.equal(failureKind("something else"), "other");
    assert.equal(failureKind(""), "other");
  });
});

describe("restartDelayMs", () => {
  it("waits minutes after a refused sign-in or a locked camera", () => {
    assert.deepEqual(
      [1, 2, 3, 4, 9].map((n) => restartDelayMs("auth", n)),
      [2 * MIN, 5 * MIN, 10 * MIN, 15 * MIN, 15 * MIN]
    );
    assert.deepEqual(
      [1, 2, 3, 7].map((n) => restartDelayMs("locked", n)),
      [5 * MIN, 10 * MIN, 15 * MIN, 15 * MIN]
    );
  });

  it("keeps reconnecting quickly after a drop-out (2 s → 30 s)", () => {
    for (const kind of ["unreachable", "notFound", "other"]) {
      assert.deepEqual(
        [1, 2, 3, 4, 5, 6, 20].map((n) => restartDelayMs(kind, n)),
        [2000, 4000, 8000, 16000, 30000, 30000, 30000]
      );
    }
  });
});

describe("describeFailure for a locked camera", () => {
  it("says the camera locked itself, how to recover, and when it tries again", () => {
    const text = describeFailure("Server returned 400 Bad Request", 5 * MIN);
    assert.match(text, /The camera is locked/);
    assert.match(text, /Restart the camera/);
    assert.match(text, /tries again in 5 min/);
    assert.ok(text.length <= 255);
  });

  it("tells a wrong password that saving the camera retries at once", () => {
    const text = describeFailure("method DESCRIBE failed: 401 Unauthorized", 2 * MIN);
    assert.match(text, /username\/password/);
    assert.match(text, /retries at once/);
    assert.match(text, /tries again in 2 min/);
  });
});

describe("CourtRecorder after a refusal", () => {
  let dir;
  let recorders;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-lock-"));
    recorders = [];
  });
  afterEach(async () => {
    for (const recorder of recorders) recorder.stop?.();
    await fs.rm(dir, { recursive: true, force: true });
  });

  /** A recorder whose ffmpeg prints `stderr` and exits at once, every time. */
  const failingRecorder = (stderr) => {
    const children = [];
    const spawnImpl = (bin, args) => {
      const child = new EventEmitter();
      Object.assign(child, {
        bin,
        args,
        pid: 2000 + children.length,
        stderr: new PassThrough(),
        kill() {},
      });
      children.push(child);
      setImmediate(() => {
        child.stderr.write(`${stderr}\n`);
        setImmediate(() => child.emit("close", 1, null));
      });
      return child;
    };
    const recorder = new CourtRecorder({
      court: { courtId: "court-1", name: "Court 1", cameraRtspUrl: "rtsp://u:pw@10.0.0.9/stream1" },
      dir: path.join(dir, "court-1"),
      settings: { segmentSeconds: 2, recordAudio: true, ffmpegPath: "ffmpeg", bufferSeconds: 180 },
      ffmpegMajor: 9,
      log: silent,
      spawnImpl,
    });
    recorders.push(recorder);
    return { recorder, children };
  };

  const waitFor = async (fn) => {
    for (let i = 0; i < 200 && !fn(); i += 1) await new Promise((r) => setTimeout(r, 5));
    assert.ok(fn());
  };

  it("waits 5 minutes after the camera locked itself, and says so", async () => {
    const { recorder, children } = failingRecorder(LOCKED);
    recorder.start();
    await waitFor(() => recorder.state === "error");
    assert.equal(recorder.nextRestartDelayMs, 5 * MIN);
    assert.match(recorder.status().message, /The camera is locked/);
    assert.equal(recorder.status().status, "error");
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(children.length, 1, "no quick reconnect");
  });

  it("waits 2 minutes after a wrong password", async () => {
    const { recorder } = failingRecorder("method DESCRIBE failed: 401 Unauthorized");
    recorder.start();
    await waitFor(() => recorder.state === "error");
    assert.equal(recorder.nextRestartDelayMs, 2 * MIN);
    assert.doesNotMatch(recorder.status().message, /pw@/, "no password in the message");
  });

  it("still reconnects in 2 s after a Wi-Fi drop-out", async () => {
    const { recorder } = failingRecorder("Error opening input files: Operation timed out");
    recorder.start();
    await waitFor(() => recorder.state === "error");
    assert.equal(recorder.nextRestartDelayMs, 2000);
  });
});
