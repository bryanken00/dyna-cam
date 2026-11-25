import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { makePrivate, PRIVATE_UMASK, procHidesOthers, setupWarnings } from "../src/hardening.js";
import { isLoopbackHost } from "../src/util.js";

const POSIX = process.platform !== "win32";
let dir;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-hard-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const modeOf = async (target) => (await fs.stat(target)).mode & 0o777;

describe("makePrivate (CR-044)", () => {
  it(
    "takes group/other access off .env and DATA_DIR, and leaves private ones alone",
    {
      skip: !POSIX,
    },
    async () => {
      const env = path.join(dir, ".env");
      const data = path.join(dir, "data");
      const done = path.join(dir, "already");
      await fs.writeFile(env, "API_URL=https://x\n", { mode: 0o644 });
      await fs.chmod(env, 0o644);
      await fs.mkdir(data);
      await fs.chmod(data, 0o755);
      await fs.mkdir(done);
      await fs.chmod(done, 0o700);

      const { fixed, warnings } = await makePrivate([
        { path: env, mode: 0o600 },
        { path: data, mode: 0o700 },
        { path: done, mode: 0o700 },
        { path: path.join(dir, "missing"), mode: 0o700 },
      ]);
      assert.deepEqual(fixed, [env, data]);
      assert.deepEqual(warnings, []);
      assert.equal(await modeOf(env), 0o600);
      assert.equal(await modeOf(data), 0o700);
    }
  );

  it("warns with the command to run when it can't change a file", async () => {
    const fake = {
      stat: async () => ({ mode: 0o100644 }),
      chmod: async () => {
        throw Object.assign(new Error("not yours"), { code: "EPERM" });
      },
    };
    const { fixed, warnings } = await makePrivate([{ path: "/srv/edge/.env", mode: 0o600 }], {
      platform: "linux",
      fs: fake,
    });
    assert.deepEqual(fixed, []);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /EPERM/);
    assert.match(warnings[0], /chmod 600 "\/srv\/edge\/.env"/);
  });

  it("does nothing on Windows (no Unix modes there)", async () => {
    const fake = {
      stat: async () => assert.fail("not checked on Windows"),
      chmod: async () => assert.fail("not changed on Windows"),
    };
    const result = await makePrivate([{ path: "C:\\edge\\.env", mode: 0o600 }], {
      platform: "win32",
      fs: fake,
    });
    assert.deepEqual(result, { fixed: [], warnings: [] });
  });

  it("the umask makes new files 0600 and folders 0700", () => {
    assert.equal(0o666 & ~PRIVATE_UMASK, 0o600);
    assert.equal(0o777 & ~PRIVATE_UMASK, 0o700);
  });
});

describe("procHidesOthers", () => {
  const mounts = (options) =>
    `sysfs /sys sysfs rw,nosuid 0 0\nproc /proc proc ${options} 0 0\ntmpfs /run tmpfs rw 0 0\n`;
  it("reads hidepid from /proc's mount options", () => {
    assert.equal(procHidesOthers(mounts("rw,nosuid,nodev,noexec,relatime")), false);
    assert.equal(procHidesOthers(mounts("rw,relatime,hidepid=0")), false);
    assert.equal(procHidesOthers(mounts("rw,relatime,hidepid=2")), true);
    assert.equal(procHidesOthers(mounts("rw,relatime,hidepid=invisible")), true);
    assert.equal(procHidesOthers(mounts("rw,hidepid=1,gid=4")), true);
  });
  it("is unknown without /proc", () => {
    assert.equal(procHidesOthers(null), null);
    assert.equal(procHidesOthers("tmpfs /run tmpfs rw 0 0\n"), null);
  });
});

describe("setupWarnings", () => {
  const settings = { livePort: 8090, certPath: "/etc/ssl/box" };
  const hidden = "proc /proc proc rw,hidepid=2 0 0\n";
  const open = "proc /proc proc rw,relatime 0 0\n";

  it("says nothing for a well set-up box", () => {
    assert.deepEqual(
      setupWarnings({ settings, platform: "linux", uid: 1001, procMounts: hidden }),
      []
    );
    assert.deepEqual(
      setupWarnings({ settings, platform: "darwin", uid: 501, procMounts: null }),
      []
    );
    assert.deepEqual(
      setupWarnings({
        settings: { livePort: 0, certPath: null },
        platform: "win32",
        uid: null,
        procMounts: null,
      }),
      [],
      "live view off: no HTTPS warning"
    );
  });

  it("warns about root, a plain-HTTP live view and a readable process list", () => {
    const lines = setupWarnings({
      settings: { livePort: 8090, certPath: null },
      platform: "linux",
      uid: 0,
      procMounts: open,
    });
    assert.equal(lines.length, 3);
    assert.match(lines[0], /running as root/);
    assert.match(lines[1], /plain HTTP.*CERT_PATH/);
    assert.match(lines[2], /hidepid=2/);
  });

  it("only checks the process list on Linux", () => {
    assert.deepEqual(
      setupWarnings({ settings, platform: "darwin", uid: 501, procMounts: open }),
      []
    );
  });
});

describe("isLoopbackHost", () => {
  it("is true only for this machine", () => {
    for (const host of ["localhost", "LOCALHOST", "127.0.0.1", "[::1]"]) {
      assert.equal(isLoopbackHost(host), true, host);
    }
    for (const host of [
      "192.168.1.10",
      "api.example.com",
      "localhost.evil.com",
      "127.0.0.1.nip.io",
    ]) {
      assert.equal(isLoopbackHost(host), false, host);
    }
  });
});
