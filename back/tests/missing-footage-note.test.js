// CR-004 / CR-006 — a game's missing footage is told in minutes and times,
// never "parts". The stretches come from the box with each camera's file.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { missingFootageNote, uploadPercent } from "../server/src/utils/sessions.js";

const gap = (start, end) => ({ startAt: `2026-11-18 ${start}:00`, endAt: `2026-11-18 ${end}:00` });

describe("missingFootageNote", () => {
  it("is null when nothing is missing", () => {
    assert.equal(missingFootageNote([{ camera: 0, gaps: [] }]), null);
  });

  it("adds up the stretches of one camera", () => {
    assert.equal(
      missingFootageNote([{ camera: 0, gaps: [gap("11:23", "11:31")] }]),
      "8 minutes weren't recorded (11:23 – 11:31 AM)"
    );
  });

  it("lists separate stretches, and says AM/PM on both ends across noon", () => {
    assert.equal(
      missingFootageNote([{ camera: 0, gaps: [gap("12:00", "12:01"), gap("11:50", "11:55")] }]),
      "6 minutes weren't recorded (11:50 – 11:55 AM, 12:00 – 12:01 PM)"
    );
    assert.equal(
      missingFootageNote([{ camera: 0, gaps: [gap("11:58", "12:03")] }]),
      "5 minutes weren't recorded (11:58 AM – 12:03 PM)"
    );
  });

  it("names the camera on a two-camera game", () => {
    assert.equal(
      missingFootageNote([
        { camera: 2, gaps: [gap("10:00", "10:05")] },
        { camera: 1, gaps: [gap("10:05", "10:06")] },
      ]),
      "Cam 1: 1 minute wasn't recorded (10:05 – 10:06 AM); Cam 2: 5 minutes weren't recorded (10:00 – 10:05 AM)"
    );
  });
});

describe("uploadPercent", () => {
  it("is null until the box sends, then counts every camera's bytes", () => {
    assert.equal(uploadPercent([{ status: "Pending", uploadBytes: null, receivedBytes: 0 }]), null);
    assert.equal(
      uploadPercent([
        { status: "Uploading", uploadBytes: 1000, receivedBytes: 250 },
        { status: "Uploading", uploadBytes: 1000, receivedBytes: 650 },
      ]),
      45
    );
    assert.equal(
      uploadPercent([
        { status: "Ready", uploadBytes: 1000, sizeBytes: 1000, receivedBytes: 1000 },
        { status: "Pending", uploadBytes: null, receivedBytes: 0 },
      ]),
      100,
      "only cameras already sending count"
    );
  });
});
