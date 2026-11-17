import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { backoffMs, maskCredentials, safeId, truncate } from "../src/util.js";

describe("maskCredentials", () => {
  it("hides the password of an RTSP URL but keeps the user and host", () => {
    assert.equal(
      maskCredentials("rtsp://camuser:s3cret@192.168.1.50:554/stream1"),
      "rtsp://camuser:***@192.168.1.50:554/stream1"
    );
  });

  it("covers passwords with a raw @ and URLs inside ffmpeg messages", () => {
    const line =
      "Error opening input file rtsp://admin:p@ss:w0rd@10.0.0.9/stream1. Connection refused";
    const masked = maskCredentials(line);
    assert.equal(
      masked,
      "Error opening input file rtsp://admin:***@10.0.0.9/stream1. Connection refused"
    );
    assert.doesNotMatch(masked, /w0rd|p@ss/);
  });

  it("masks a user-only userinfo and leaves plain URLs alone", () => {
    assert.equal(maskCredentials("rtsp://token@cam/x"), "rtsp://***@cam/x");
    assert.equal(maskCredentials("rtsp://10.0.0.9/stream1"), "rtsp://10.0.0.9/stream1");
    assert.equal(maskCredentials(null), null);
  });
});

describe("helpers", () => {
  it("safeId keeps business IDs and hashes anything else", () => {
    assert.equal(safeId("4b0c-uuid-1"), "4b0c-uuid-1");
    assert.match(safeId("../../etc"), /^id-[0-9a-f]{16}$/);
  });

  it("backoffMs doubles and caps", () => {
    assert.deepEqual(
      [1, 2, 3, 4, 5, 6].map((n) => backoffMs(n, 2000, 30_000)),
      [2000, 4000, 8000, 16_000, 30_000, 30_000]
    );
  });

  it("truncate keeps reasons within 255 chars", () => {
    assert.equal(truncate("x".repeat(300)).length, 255);
    assert.equal(truncate("  ok "), "ok");
  });
});
