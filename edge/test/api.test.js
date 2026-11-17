import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { ApiError, createApi } from "../src/api.js";

let server;
let baseUrl;
const seen = [];

before(async () => {
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      const send = (status, payload) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.url === "/api/v1/device/config") {
        return send(200, {
          success: true,
          message: "Recorder configuration",
          data: { courts: [{ courtId: "c1" }] },
        });
      }
      if (req.url.startsWith("/api/v1/device/jobs"))
        return send(200, { success: true, message: "Jobs", data: { jobs: [] } });
      if (req.url === "/api/v1/device/buttons/court-1/press") {
        return send(201, {
          success: true,
          message: "Saving the clip",
          data: { clipId: "c9", shareUrl: "https://app/clip/t", merged: false },
        });
      }
      if (req.url === "/api/v1/device/courts/court-1/snapshot") {
        return send(200, { success: true, message: "Snapshot saved", data: { snapshotAt: "x" } });
      }
      if (req.url.endsWith("/processing"))
        return send(409, {
          success: false,
          message: "This clip is already ready",
          code: "INVALID_STATUS",
        });
      if (req.url.endsWith("/upload"))
        return send(200, { success: true, message: "Clip uploaded", data: { status: "Ready" } });
      if (req.url.endsWith("/fail"))
        return send(401, {
          success: false,
          message: "This recorder box is not registered or has been revoked",
        });
      if (req.url.startsWith("/public/uploads/logo.png")) {
        res.writeHead(200, { "Content-Type": "image/png" });
        return res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      }
      if (req.url === "/api/v1/device/heartbeat") {
        res.writeHead(429, { "Retry-After": "7" });
        return res.end("Too many requests");
      }
      return send(404, { success: false, message: "Not found" });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const api = () =>
  createApi({ apiUrl: baseUrl, deviceToken: "tok-123", userAgent: "DynaCamRecorder/1.0.0" });

describe("device API client", () => {
  it("sends the device token and the User-Agent, and unwraps data", async () => {
    const data = await api().getConfig();
    assert.deepEqual(data, { courts: [{ courtId: "c1" }] });
    const req = seen.at(-1);
    assert.equal(req.headers.authorization, "Device tok-123");
    assert.equal(req.headers["user-agent"], "DynaCamRecorder/1.0.0");
  });

  it("relays a button press with pressedAtMs", async () => {
    const data = await api().pressButton("court-1", 1794881000123);
    assert.equal(data.shareUrl, "https://app/clip/t");
    assert.deepEqual(JSON.parse(seen.at(-1).body), { pressedAtMs: 1794881000123 });
  });

  it("long-polls with ?wait=", async () => {
    await api().getJobs(25);
    assert.equal(seen.at(-1).url, "/api/v1/device/jobs?wait=25");
  });

  it("throws typed errors with the status", async () => {
    await assert.rejects(api().claimClip("abc"), (err) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 409);
      assert.equal(err.isGone, true);
      assert.equal(err.detail, "This clip is already ready");
      return true;
    });
    await assert.rejects(
      api().failClip("abc", "x".repeat(400)),
      (err) => err.status === 401 && err.isRetryable
    );
    assert.equal(JSON.parse(seen.at(-1).body).reason.length, 255);
    await assert.rejects(
      api().heartbeat({}),
      (err) => err.status === 429 && err.retryAfterMs === 7000
    );
  });

  it("reports an unreachable API as a network error (status 0)", async () => {
    const offline = createApi({
      apiUrl: "http://127.0.0.1:1",
      deviceToken: "t",
      userAgent: "DynaCamRecorder/1.0.0",
    });
    await assert.rejects(offline.getConfig(), (err) => err.isNetwork && err.isRetryable);
  });

  it("uploads multipart video/mp4 + image/jpeg with the right file names", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-api-"));
    try {
      await fs.writeFile(path.join(dir, "clip.mp4"), "MP4DATA");
      await fs.writeFile(path.join(dir, "thumbnail.jpg"), "JPGDATA");
      await api().uploadClip("clip-9", {
        videoPath: path.join(dir, "clip.mp4"),
        thumbnailPath: path.join(dir, "thumbnail.jpg"),
      });
      const req = seen.at(-1);
      assert.equal(req.url, "/api/v1/device/clips/clip-9/upload");
      assert.match(req.headers["content-type"], /^multipart\/form-data; boundary=/);
      const body = req.body.toString();
      assert.match(
        body,
        /name="video"; filename="clip\.mp4"\r\nContent-Type: video\/mp4\r\n\r\nMP4DATA/
      );
      assert.match(
        body,
        /name="thumbnail"; filename="thumbnail\.jpg"\r\nContent-Type: image\/jpeg\r\n\r\nJPGDATA/
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("uploads a preview snapshot as multipart image/jpeg", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-api-"));
    try {
      await fs.writeFile(path.join(dir, "preview.jpg"), "JPGDATA");
      await api().uploadSnapshot("court-1", path.join(dir, "preview.jpg"));
      const body = seen.at(-1).body.toString();
      assert.equal(seen.at(-1).url, "/api/v1/device/courts/court-1/snapshot");
      assert.match(
        body,
        /name="snapshot"; filename="snapshot\.jpg"\r\nContent-Type: image\/jpeg\r\n\r\nJPGDATA/
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("downloads the signed relative logo link", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-api-"));
    try {
      const dest = path.join(dir, "logo.png");
      await api().downloadFile("/public/uploads/logo.png?expires=1&signature=abc", dest);
      assert.equal((await fs.readFile(dest)).length, 4);
      assert.equal(seen.at(-1).headers["user-agent"], "DynaCamRecorder/1.0.0");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
