import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ApiError } from "../src/api.js";
import {
  CredentialsError,
  DEVICE_FILE,
  enroll,
  ENROLL_RETRY_MAX_MS,
  enrollHash,
  markRevoked,
  REFUSED_FILE,
  resolveCredentials,
  REVOKED_FILE,
} from "../src/credentials.js";
import { createLogger } from "../src/log.js";
import { maskCredentials, registerSecret } from "../src/util.js";

const NOW = 1_794_881_000_000;
const KEY = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0";
let dir;
let logged;
const log = {
  debug: (m, e) => logged.push(`${m}${e ? ` ${e.message || e}` : ""}`),
  info: (m, e) => logged.push(`${m}${e ? ` ${e.message || e}` : ""}`),
  warn: (m, e) => logged.push(`${m}${e ? ` ${e.message || e}` : ""}`),
  error: (m, e) => logged.push(`${m}${e ? ` ${e.message || e}` : ""}`),
};
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-cred-"));
  logged = [];
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

const ENROLLED = {
  token: "dcb_0123456789abcdef0123456789abcdef",
  device: { deviceId: "dev-1", name: "Court box" },
  venue: { venueId: "ven-1", name: "Pickle Palace" },
};

/** enroll answers from a list: an object = success, an Error = failure. */
function fakeApi(answers) {
  const calls = [];
  return {
    calls,
    enroll: async (body) => {
      calls.push(body);
      const next = answers.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  };
}
const apiError = (status, extra = {}) =>
  new ApiError(`POST /enroll: HTTP ${status}`, { status, ...extra });
const settings = (extra = {}) => ({
  dataDir: dir,
  enrollKey: KEY,
  venueId: "ven-1",
  boxName: "Court box",
  ...extra,
});
const args = (api, extra = {}, sleeps = []) => ({
  settings: settings(extra),
  api,
  agentVersion: "1.0.0",
  log,
  sleep: async (ms) => sleeps.push(ms),
  now: () => NOW,
});

describe("resolveCredentials: which token", () => {
  it("uses device.json first and never enrols then", async () => {
    await fs.writeFile(path.join(dir, DEVICE_FILE), JSON.stringify({ token: "dcb_saved" }));
    const api = fakeApi([]);
    const creds = await resolveCredentials(args(api));
    assert.equal(creds.token, "dcb_saved");
    assert.equal(creds.source, "stored");
    assert.equal(api.calls.length, 0);
  });

  it("enrols with .env, saves device.json (0600) and logs neither token nor key", async () => {
    const api = fakeApi([ENROLLED]);
    const creds = await resolveCredentials(args(api));
    assert.equal(creds.source, "enrolled");
    assert.equal(creds.token, ENROLLED.token);
    assert.deepEqual(api.calls, [
      { enrollKey: KEY, venueId: "ven-1", name: "Court box", agentVersion: "1.0.0" },
    ]);
    const file = path.join(dir, DEVICE_FILE);
    const saved = JSON.parse(await fs.readFile(file, "utf8"));
    assert.equal(saved.token, ENROLLED.token);
    assert.equal(saved.deviceId, "dev-1");
    assert.equal(saved.venueName, "Pickle Palace");
    assert.ok(!JSON.stringify(saved).includes(KEY), "the enrol key isn't saved");
    if (process.platform !== "win32") assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    assert.match(logged.join("\n"), /Enrolled as Court box for Pickle Palace/);
    assert.ok(logged.every((m) => !m.includes(ENROLLED.token) && !m.includes(KEY)));
  });

  it("asks a person to act when .env has no enrol values", async () => {
    await assert.rejects(
      resolveCredentials(args(fakeApi([]), { enrollKey: null, venueId: null })),
      (err) => err instanceof CredentialsError && /set ENROLL_KEY and VENUE_ID/.test(err.message)
    );
  });
});

describe("enrolling: errors", () => {
  it("a wrong key or venue (400) is final and not sent again — until .env changes", async () => {
    const api = fakeApi([
      apiError(400, { detail: "That enrol key or venue isn't accepted" }),
      ENROLLED,
    ]);
    await assert.rejects(resolveCredentials(args(api)), (err) => {
      assert.ok(err instanceof CredentialsError);
      assert.match(err.message, /refused this box's ENROLL_KEY \/ VENUE_ID/);
      assert.match(err.message, /isn't accepted/);
      assert.ok(!err.message.includes(KEY));
      return true;
    });
    const refused = await fs.readFile(path.join(dir, REFUSED_FILE), "utf8");
    assert.ok(refused.includes(enrollHash(KEY, "ven-1")));
    assert.ok(!refused.includes(KEY), "only a hash is kept");

    // A restart with the same values: nothing sent
    await assert.rejects(resolveCredentials(args(api)), /already refused/);
    assert.equal(api.calls.length, 1);

    // A fixed VENUE_ID (or key) in .env is tried
    const creds = await resolveCredentials(args(api, { venueId: "ven-2" }));
    assert.equal(creds.token, ENROLLED.token);
    assert.equal(api.calls.length, 2);
    assert.equal(api.calls[1].venueId, "ven-2");
  });

  it("enrolment off on the API (403) retries every 5 min with a clear log", async () => {
    const sleeps = [];
    const api = fakeApi([
      apiError(403, { code: "ENROLLMENT_DISABLED" }),
      apiError(403, { code: "ENROLLMENT_DISABLED" }),
      ENROLLED,
    ]);
    const data = await enroll(args(api, {}, sleeps));
    assert.equal(data.token, ENROLLED.token);
    assert.deepEqual(sleeps, [ENROLL_RETRY_MAX_MS, ENROLL_RETRY_MAX_MS]);
    assert.equal(ENROLL_RETRY_MAX_MS, 300_000);
    assert.match(logged.join("\n"), /Enrolment is turned off on the API/);
    await assert.rejects(
      fs.access(path.join(dir, REFUSED_FILE)),
      "403 isn't remembered as refused"
    );
  });

  it("a 429 waits for Retry-After, or 60 s without it", async () => {
    const sleeps = [];
    const api = fakeApi([apiError(429, { retryAfterMs: 7000 }), apiError(429), ENROLLED]);
    await enroll(args(api, {}, sleeps));
    assert.deepEqual(sleeps, [7000, 60_000]);
    assert.match(logged.join("\n"), /paused by the API/);
  });

  it("retries network and server errors with backoff (2 s → 5 min)", async () => {
    const sleeps = [];
    const answers = Array.from({ length: 10 }, (_v, i) => apiError(i % 2 ? 503 : 0));
    const api = fakeApi([...answers, ENROLLED]);
    await enroll(args(api, {}, sleeps));
    assert.deepEqual(sleeps.slice(0, 4), [2000, 4000, 8000, 16_000]);
    assert.equal(Math.max(...sleeps), ENROLL_RETRY_MAX_MS);
  });
});

describe("revoked", () => {
  it("forgets the token and cached config, writes revoked.json (0600) and never re-enrols", async () => {
    await fs.writeFile(path.join(dir, DEVICE_FILE), JSON.stringify({ token: ENROLLED.token }));
    await fs.writeFile(path.join(dir, "config.json"), '{"courts":[]}');
    const message = await markRevoked({
      settings: settings(),
      device: { deviceId: "dev-1", name: "Court box" },
      now: () => NOW,
    });
    assert.match(
      message,
      /This box was revoked — delete .*revoked\.json \(and check \.env\) to enrol it again/
    );
    await assert.rejects(fs.access(path.join(dir, DEVICE_FILE)));
    await assert.rejects(fs.access(path.join(dir, "config.json")), "camera passwords removed");
    const file = path.join(dir, REVOKED_FILE);
    assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), {
      revokedAt: new Date(NOW).toISOString(),
      deviceId: "dev-1",
      name: "Court box",
    });
    if (process.platform !== "win32") assert.equal((await fs.stat(file)).mode & 0o777, 0o600);

    // The next start: valid .env values, but no enrolment while revoked.json is there
    const api = fakeApi([ENROLLED]);
    await assert.rejects(resolveCredentials(args(api)), (err) => {
      assert.ok(err instanceof CredentialsError);
      assert.equal(err.revoked, true);
      assert.match(err.message, /This box was revoked/);
      return true;
    });
    assert.equal(api.calls.length, 0);

    // A person deletes revoked.json: it enrols again
    await fs.rm(file);
    assert.equal((await resolveCredentials(args(api))).source, "enrolled");
  });
});

describe("masking", () => {
  it("never shows a device token in a log line", () => {
    assert.equal(
      maskCredentials("token dcb_0123456789abcdef0123456789abcdef saved"),
      "token dcb_**** saved"
    );
    assert.equal(
      maskCredentials("Authorization: Device abcdefghijklmnop"),
      "Authorization: Device ****"
    );
  });

  it("masks ENROLL_KEY anywhere once registered, even through the logger", () => {
    const secret = "Zq9-enrol-key-without-any-shape-1234567890";
    registerSecret(secret);
    assert.equal(maskCredentials(`sent ${secret} to the API`), "sent **** to the API");
    const lines = [];
    const original = console.error;
    console.error = (line) => lines.push(line);
    try {
      createLogger("t").warn(`oops ${secret}`, new Error(`key=${secret}`));
    } finally {
      console.error = original;
    }
    assert.equal(lines.length, 1);
    assert.ok(!lines[0].includes(secret));
    registerSecret("short"); // too short to register: nothing breaks
    assert.equal(maskCredentials("short"), "short");
  });
});
