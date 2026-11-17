import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ApiError } from "../src/api.js";
import {
  codeHash,
  CredentialsError,
  DEVICE_FILE,
  isCodeUsed,
  recoverFromRevoked,
  redeemPairingCode,
  resolveCredentials,
  USED_CODES_FILE,
} from "../src/credentials.js";
import { maskCredentials } from "../src/util.js";

const NOW = 1_794_881_000_000;
let dir;
let logged;
const log = {
  debug: (m) => logged.push(m),
  info: (m) => logged.push(m),
  warn: (m) => logged.push(m),
  error: (m) => logged.push(m),
};
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-cred-"));
  logged = [];
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

const PAIRED = {
  token: "dcb_0123456789abcdef0123456789abcdef",
  device: { deviceId: "dev-1", name: "Court box" },
  venue: { venueId: "ven-1", name: "Pickle Palace" },
};

/** pairDevice answers from a list: an object = success, an Error = failure. */
function fakeApi(answers) {
  const calls = [];
  return {
    calls,
    pairDevice: async (code, agentVersion) => {
      calls.push([code, agentVersion]);
      const next = answers.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  };
}
const settings = (extra = {}) => ({ dataDir: dir, pairingCode: null, ...extra });
const args = (api, extra = {}) => ({
  settings: settings(extra),
  api,
  agentVersion: "1.0.0",
  log,
  sleep: async () => {},
  now: () => NOW,
});
const writeDevice = (data) => fs.writeFile(path.join(dir, DEVICE_FILE), JSON.stringify(data));

describe("resolveCredentials: which token", () => {
  it("prefers device.json, then a PAIRING_CODE", async () => {
    const api = fakeApi([PAIRED]);
    await writeDevice({ token: "dcb_stored_token_1234", name: "Box" });
    const stored = await resolveCredentials(args(api, { pairingCode: "123456" }));
    assert.deepEqual([stored.token, stored.source], ["dcb_stored_token_1234", "stored"]);
    assert.equal(api.calls.length, 0, "no pairing while a token is saved");

    await fs.rm(path.join(dir, DEVICE_FILE));
    const paired = await resolveCredentials(args(api, { pairingCode: "123456" }));
    assert.deepEqual([paired.token, paired.source], [PAIRED.token, "paired"]);
    assert.deepEqual(api.calls, [["123456", "1.0.0"]]);
  });

  it("saves the pairing to device.json with mode 0600 and logs neither token nor key", async () => {
    await resolveCredentials(args(fakeApi([PAIRED]), { pairingCode: "123456" }));
    const file = path.join(dir, DEVICE_FILE);
    const saved = JSON.parse(await fs.readFile(file, "utf8"));
    assert.deepEqual(
      { ...saved, pairedAt: "x" },
      {
        token: PAIRED.token,
        deviceId: "dev-1",
        venueId: "ven-1",
        name: "Court box",
        venueName: "Pickle Palace",
        pairedAt: "x",
      }
    );
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    assert.ok(
      logged.includes(
        "Paired as Court box for Pickle Palace — you can remove PAIRING_CODE from .env"
      )
    );
    assert.ok(
      logged.every((m) => !String(m).includes(PAIRED.token) && !String(m).includes("123456"))
    );
    assert.equal(await isCodeUsed(dir, "123456"), true);
    const used = await fs.readFile(path.join(dir, USED_CODES_FILE), "utf8");
    assert.ok(
      !used.includes("123456") && used.includes(codeHash("123456")),
      "only the hash is kept"
    );
  });

  it("never sends the same key twice across restarts", async () => {
    const api = fakeApi([PAIRED]);
    await resolveCredentials(args(api, { pairingCode: "123456" }));
    await fs.rm(path.join(dir, DEVICE_FILE));
    await assert.rejects(resolveCredentials(args(api, { pairingCode: "123456" })), /already used/);
    assert.equal(api.calls.length, 1);
  });

  it("explains what to do when there is no key at all", async () => {
    await assert.rejects(resolveCredentials(args(fakeApi([]))), (err) => {
      assert.ok(err instanceof CredentialsError);
      assert.match(err.message, /Admin → Setup → Recorder Boxes .* PAIRING_CODE/);
      return true;
    });
  });
});

describe("redeemPairingCode: errors", () => {
  it("a 400 (wrong / expired / used key) is final and the key is remembered", async () => {
    const api = fakeApi([new ApiError("Invalid key", { status: 400 })]);
    await assert.rejects(resolveCredentials(args(api, { pairingCode: "654321" })), /not accepted/);
    assert.equal(api.calls.length, 1);
    assert.equal(await isCodeUsed(dir, "654321"), true);
    await assert.rejects(fs.access(path.join(dir, DEVICE_FILE)));
  });

  it("a 429 waits for Retry-After, or 60 s without it, then tries again", async () => {
    const waits = [];
    const api = fakeApi([
      new ApiError("paused", { status: 429, retryAfterMs: 90_000 }),
      new ApiError("too many", { status: 429 }),
      PAIRED,
    ]);
    const data = await redeemPairingCode({
      api,
      code: "123456",
      agentVersion: "1",
      log,
      sleep: async (ms) => waits.push(ms),
      now: () => NOW,
    });
    assert.equal(data.token, PAIRED.token);
    assert.deepEqual(waits, [90_000, 60_000]);
  });

  it("retries network errors with backoff and gives up after 15 minutes", async () => {
    let now = NOW;
    const waits = [];
    const api = { pairDevice: async () => Promise.reject(new ApiError("ECONNREFUSED")) };
    await assert.rejects(
      redeemPairingCode({
        api,
        code: "123456",
        agentVersion: "1",
        log,
        now: () => now,
        sleep: async (ms) => {
          waits.push(ms);
          now += ms;
        },
      }),
      /Could not pair with the API for 15 minutes/
    );
    assert.deepEqual(waits.slice(0, 4), [2000, 4000, 8000, 16_000]);
    assert.ok(now - NOW <= 15 * 60_000);
  });
});

describe("recoverFromRevoked", () => {
  it("deletes device.json and pairs with a NEW key", async () => {
    await writeDevice({ token: "dcb_old_token_1234" });
    const api = fakeApi([PAIRED]);
    const creds = await recoverFromRevoked(args(api, { pairingCode: "111222" }));
    assert.equal(creds.token, PAIRED.token);
    assert.ok(
      logged.includes("This box was revoked — add it again in Admin to get a new pairing key")
    );
    assert.equal(
      JSON.parse(await fs.readFile(path.join(dir, DEVICE_FILE), "utf8")).token,
      PAIRED.token
    );
  });

  it("does not retry the key it was paired with; cleans up and asks for a new one", async () => {
    const api = fakeApi([PAIRED]);
    await resolveCredentials(args(api, { pairingCode: "123456" }));
    await assert.rejects(
      recoverFromRevoked(args(api, { pairingCode: "123456" })),
      /Recorder Boxes/
    );
    assert.equal(api.calls.length, 1);
    await assert.rejects(fs.access(path.join(dir, DEVICE_FILE)), "revoked token forgotten");
  });

  it("without any PAIRING_CODE just forgets the token (and the cached camera config)", async () => {
    await writeDevice({ token: "dcb_old_token_1234" });
    await fs.writeFile(path.join(dir, "config.json"), "{}");
    await assert.rejects(recoverFromRevoked(args(fakeApi([]))), CredentialsError);
    await assert.rejects(fs.access(path.join(dir, DEVICE_FILE)));
    await assert.rejects(fs.access(path.join(dir, "config.json")));
  });
});

describe("masking", () => {
  it("never shows a device token in a log line", () => {
    assert.equal(maskCredentials(`got ${PAIRED.token}`), "got dcb_****");
    assert.equal(
      maskCredentials("Authorization: Device 9f86d081884c7d659a2feaa0c55ad015"),
      "Authorization: Device ****"
    );
  });
});
