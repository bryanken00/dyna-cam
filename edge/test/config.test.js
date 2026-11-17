import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { ConfigError, loadConfig, parsePairingCode, ROOT_DIR, USER_AGENT } from "../src/config.js";

const base = { API_URL: "https://api.example.com/" };

describe("loadConfig", () => {
  it("fails fast without API_URL; DEVICE_TOKEN is only noticed, never used", () => {
    assert.throws(
      () => loadConfig({}),
      (err) => {
        assert.ok(err instanceof ConfigError);
        assert.match(err.message, /Missing API_URL/);
        assert.match(err.message, /PAIRING_CODE/);
        return true;
      }
    );
    const cfg = loadConfig({ API_URL: "https://x.test" });
    assert.equal(cfg.pairingCode, null);
    assert.equal(cfg.ignoredDeviceToken, false);
    assert.equal(cfg.deviceToken, undefined, "DEVICE_TOKEN is no longer read");
    const old = loadConfig({ API_URL: "https://x.test", DEVICE_TOKEN: "dcb_old" });
    assert.equal(old.ignoredDeviceToken, true);
    assert.ok(!JSON.stringify(old).includes("dcb_old"), "the old token isn't kept");
  });

  it("reads PAIRING_CODE as typed (spaces and dashes) and rejects anything but 6 digits", () => {
    assert.equal(parsePairingCode("123 456"), "123456");
    assert.equal(parsePairingCode(" 123-456 "), "123456");
    assert.equal(parsePairingCode(""), null);
    assert.equal(parsePairingCode(undefined), null);
    assert.equal(
      loadConfig({ API_URL: "https://x.test", PAIRING_CODE: "000 042" }).pairingCode,
      "000042"
    );
    for (const bad of ["12345", "1234567", "12a456"]) {
      assert.throws(() => parsePairingCode(bad), /6-digit key/, bad);
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
