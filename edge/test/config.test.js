import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  ConfigError,
  leftoverWarnings,
  loadConfig,
  parseEnrollment,
  ROOT_DIR,
  USER_AGENT,
} from "../src/config.js";

const KEY = "k".repeat(40);
const base = { API_URL: "https://api.example.com/", ENROLL_KEY: KEY, VENUE_ID: "ven-1" };

/** A DATA_DIR with or without device.json (the box enrolled before). */
const dataDir = (enrolled) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "edge-cfg-"));
  if (enrolled) fs.writeFileSync(path.join(dir, "device.json"), "{}");
  return dir;
};

describe("loadConfig", () => {
  it("fails fast without API_URL; DEVICE_TOKEN and PAIRING_CODE are only noticed, never used", () => {
    assert.throws(
      () => loadConfig({}),
      (err) => {
        assert.ok(err instanceof ConfigError);
        assert.match(err.message, /Missing API_URL/);
        assert.match(err.message, /ENROLL_KEY/);
        return true;
      }
    );
    const cfg = loadConfig(base);
    assert.equal(cfg.ignoredDeviceToken, false);
    assert.equal(cfg.ignoredPairingCode, false);
    assert.equal(cfg.deviceToken, undefined, "DEVICE_TOKEN is no longer read");
    assert.equal(cfg.pairingCode, undefined, "PAIRING_CODE is no longer read");
    const old = loadConfig({ ...base, DEVICE_TOKEN: "dcb_old", PAIRING_CODE: "123 456" });
    assert.equal(old.ignoredDeviceToken, true);
    assert.equal(old.ignoredPairingCode, true);
    assert.ok(!JSON.stringify(old).includes("dcb_old"), "the old token isn't kept");
    assert.ok(!JSON.stringify(old).includes("123 456"), "the old key isn't kept");
    const warnings = leftoverWarnings(old);
    assert.equal(warnings.length, 2);
    assert.match(warnings[0], /DEVICE_TOKEN in \.env is no longer used/);
    assert.match(warnings[1], /PAIRING_CODE in \.env is no longer used/);
    assert.ok(warnings.every((w) => !w.includes("dcb_old") && !w.includes("123 456")));
    assert.deepEqual(leftoverWarnings(cfg), []);
  });

  it("reads ENROLL_KEY, VENUE_ID and BOX_NAME (default the hostname, ≤ 100 chars)", () => {
    const cfg = loadConfig({ ...base, ENROLL_KEY: `  ${KEY} `, BOX_NAME: " Bry's Table " });
    assert.equal(cfg.enrollKey, KEY);
    assert.equal(cfg.venueId, "ven-1");
    assert.equal(cfg.boxName, "Bry's Table");
    const dir = dataDir(false);
    assert.equal(parseEnrollment(base, dir, { hostname: () => "n100-box" }).boxName, "n100-box");
    assert.equal(parseEnrollment({ ...base, BOX_NAME: "x".repeat(150) }, dir).boxName.length, 100);
  });

  it("needs ENROLL_KEY + VENUE_ID until the box has device.json", () => {
    const fresh = dataDir(false);
    const done = dataDir(true);
    const env = { API_URL: "https://x.test" };
    assert.throws(() => loadConfig({ ...env, DATA_DIR: fresh }), /Missing ENROLL_KEY/);
    const enrolled = loadConfig({ ...env, DATA_DIR: done });
    assert.equal(enrolled.enrollKey, null);
    assert.equal(enrolled.venueId, null);
    assert.throws(
      () => loadConfig({ ...env, DATA_DIR: fresh, ENROLL_KEY: KEY }),
      /Missing VENUE_ID/
    );
  });

  it("rejects a short ENROLL_KEY and a malformed VENUE_ID, without echoing the key", () => {
    const short = "s3cr3t-but-short";
    assert.throws(
      () => loadConfig({ ...base, ENROLL_KEY: short }),
      (err) => {
        assert.ok(err instanceof ConfigError);
        assert.match(err.message, /at least 32 characters/);
        assert.match(err.message, /RECORDER_ENROLL_KEY/);
        assert.ok(!err.message.includes(short));
        return true;
      }
    );
    for (const bad of ["ven 1", "ven/1", "x".repeat(51), "vén"]) {
      assert.throws(() => loadConfig({ ...base, VENUE_ID: bad }), /VENUE_ID must be/, bad);
    }
  });

  it("applies the defaults and strips the trailing slash", () => {
    const cfg = loadConfig(base);
    assert.equal(cfg.apiUrl, "https://api.example.com");
    assert.equal(cfg.segmentSeconds, 2);
    assert.equal(cfg.bufferSeconds, 180);
    assert.equal(cfg.encoder, "auto");
    assert.equal(cfg.heartbeatSeconds, 30);
    assert.equal(cfg.configRefreshSeconds, 60);
    assert.equal(cfg.recordAudio, true);
    assert.equal(cfg.dataDir, path.join(ROOT_DIR, "data"));
    assert.equal(cfg.maxStackedStreams, 2);
  });

  it("turns the button listener on by default and off with an empty/0 port", () => {
    const cfg = loadConfig(base);
    assert.equal(cfg.buttonPort, 8089);
    assert.equal(cfg.buttonHost, "0.0.0.0");
    assert.equal(cfg.buttonKey, "");
    assert.equal(loadConfig({ ...base, BUTTON_PORT: "" }).buttonPort, 0);
    assert.equal(loadConfig({ ...base, BUTTON_PORT: "0" }).buttonPort, 0);
    assert.equal(loadConfig({ ...base, BUTTON_PORT: "9000", BUTTON_KEY: " k " }).buttonKey, "k");
    assert.throws(() => loadConfig({ ...base, BUTTON_PORT: "70000" }), /BUTTON_PORT/);
  });

  it("rejects bad values", () => {
    assert.throws(() => loadConfig({ ...base, ENCODER: "nvenc" }), /ENCODER must be one of/);
    assert.throws(() => loadConfig({ ...base, BUFFER_SECONDS: "30" }), /BUFFER_SECONDS/);
    assert.throws(() => loadConfig({ ...base, API_URL: "ftp://x" }), /https/);
    assert.throws(() => loadConfig({ ...base, RECORD_AUDIO: "maybe" }), /RECORD_AUDIO/);
  });

  it("uses a User-Agent the API's bot filter lets through", () => {
    assert.match(USER_AGENT, /^DynaCamRecorder\/\d+\.\d+\.\d+$/);
    assert.doesNotMatch(USER_AGENT.toLowerCase(), /bot|crawler|spider|scraper/);
  });
});
