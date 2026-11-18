// CR-004 — a game's missing footage is told in minutes and times, never "parts".

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { missingFootageNote, savingProgress } from "../server/src/utils/sessions.js";

const part = (camera, status, start, end) => ({
  camera,
  status,
  windowStartAt: `2026-11-18 ${start}:00`,
  windowEndAt: `2026-11-18 ${end}:00`,
});

describe("missingFootageNote", () => {
  it("is null when every part was recorded", () => {
    assert.equal(missingFootageNote([part(0, "Ready", "11:18", "11:23")]), null);
  });

  it("merges neighbouring missing parts into one stretch", () => {
    const note = missingFootageNote([
      part(0, "Ready", "11:18", "11:23"),
      part(0, "Failed", "11:23", "11:28"),
      part(0, "Failed", "11:28", "11:31"),
    ]);
    assert.equal(note, "8 minutes weren't recorded (11:23 – 11:31 AM)");
  });

  it("lists separate stretches, and says AM/PM on both ends across noon", () => {
    const note = missingFootageNote([
      part(0, "Failed", "11:50", "11:55"),
      part(0, "Ready", "11:55", "12:00"),
      part(0, "Failed", "12:00", "12:01"),
    ]);
    assert.equal(note, "6 minutes weren't recorded (11:50 – 11:55 AM, 12:00 – 12:01 PM)");
    const crossing = missingFootageNote([part(0, "Failed", "11:58", "12:03")]);
    assert.equal(crossing, "5 minutes weren't recorded (11:58 AM – 12:03 PM)");
  });

  it("names the camera on a two-camera game", () => {
    const note = missingFootageNote([
      part(1, "Ready", "10:00", "10:05"),
      part(2, "Failed", "10:00", "10:05"),
      part(1, "Failed", "10:05", "10:06"),
      part(2, "Ready", "10:05", "10:06"),
    ]);
    assert.equal(
      note,
      "Cam 1: 1 minute wasn't recorded (10:05 – 10:06 AM); Cam 2: 5 minutes weren't recorded (10:00 – 10:05 AM)"
    );
  });
});

describe("savingProgress", () => {
  it("counts settled minutes once, whatever the number of cameras", () => {
    const game = { startAt: "2026-11-18 10:00:00", endAt: "2026-11-18 10:30:00" };
    assert.deepEqual(savingProgress({ ...game, partCameras: 1, settledPartSeconds: 1500 }), {
      savedSeconds: 1500,
      totalSeconds: 1800,
    });
    assert.deepEqual(savingProgress({ ...game, partCameras: 2, settledPartSeconds: 3000 }), {
      savedSeconds: 1500,
      totalSeconds: 1800,
    });
    assert.deepEqual(savingProgress({ ...game, partCameras: 1, settledPartSeconds: 9999 }), {
      savedSeconds: 1800,
      totalSeconds: 1800,
    });
  });
});
