import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { ConfigError, loadConfig, ROOT_DIR, USER_AGENT } from "../src/config.js";

const base = { API_URL: "https://api.example.com/", DEVICE_TOKEN: "tok" };

describe("loadConfig", () => {
  it("fails fast with a clear message when API_URL / DEVICE_TOKEN are missing", () => {
    assert.throws(
      () => loadConfig({}),
      (err) => {
        assert.ok(err instanceof ConfigError);
        assert.match(err.message, /API_URL and DEVICE_TOKEN/);
        assert.match(err.message, /Recorder boxes/);
        return true;
      }
    );
    assert.throws(() => loadConfig({ API_URL: "https://x.test" }), /Missing DEVICE_TOKEN/);
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
