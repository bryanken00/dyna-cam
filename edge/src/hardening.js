import fsp from "node:fs/promises";

/**
 * CR-044: the box's own security checks at start-up. A box holds its venue's
 * camera passwords and stream keys, its own token and players' game videos, so:
 *
 * - everything it creates is private to its own account (`PRIVATE_UMASK`, set
 *   first thing in index.js; ffmpeg inherits it, so buffer segments and kept
 *   videos are 0600 in 0700 folders);
 * - `.env` and `DATA_DIR`, made before that (or by an older box), are tightened
 *   (`makePrivate`);
 * - anything still unsafe is logged as a warning (`setupWarnings`) — the box
 *   keeps recording; docs/recorder-box-security.md says how to fix each one.
 *
 * Windows has no Unix modes: its files are private by living in the box
 * account's own folder (see the guide), so nothing here runs there.
 */

/** New files 0600, new folders 0700. */
export const PRIVATE_UMASK = 0o077;

export const SECURITY_GUIDE = "docs/recorder-box-security.md";

/**
 * Take group/other access off each path that exists and has any. Returns a
 * warning per path it could not fix (another owner, read-only disk, …).
 *
 * @param {{ path: string, mode: number }[]} targets  mode = the private mode (0o600 / 0o700)
 * @returns {Promise<{ fixed: string[], warnings: string[] }>}
 */
export async function makePrivate(targets, { platform = process.platform, fs = fsp } = {}) {
  const fixed = [];
  const warnings = [];
  if (platform === "win32") return { fixed, warnings };
  for (const { path: target, mode } of targets) {
    let stat;
    try {
      stat = await fs.stat(target);
    } catch (err) {
      if (err.code !== "ENOENT") warnings.push(`could not check ${target}: ${err.message}`);
      continue;
    }
    if ((stat.mode & 0o077) === 0) continue;
    try {
      await fs.chmod(target, mode);
      fixed.push(target);
    } catch (err) {
      warnings.push(
        `${target} can be read by other accounts on this machine and could not be made private ` +
          `(${err.code || err.message}) — run: chmod ${mode.toString(8)} "${target}"`
      );
    }
  }
  return { fixed, warnings };
}

/**
 * Is /proc mounted so other accounts can't read a process's command line?
 * ffmpeg's command line carries the camera address (with its password) and
 * live-stream keys. `procMounts` = the text of /proc/mounts; null = unknown.
 */
export function procHidesOthers(procMounts) {
  if (typeof procMounts !== "string") return null;
  for (const line of procMounts.split("\n")) {
    const [, mountPoint, type, options = ""] = line.trim().split(/\s+/);
    if (type !== "proc" || mountPoint !== "/proc") continue;
    const hidepid = options.split(",").find((option) => option.startsWith("hidepid="));
    const value = hidepid?.slice("hidepid=".length);
    return Boolean(value) && !["0", "off"].includes(value);
  }
  return null;
}

/**
 * What is unsafe about how this box is set up (pure; index.js gathers the facts).
 *
 * @param {object} facts
 * @param {object} facts.settings     loadConfig()
 * @param {string} facts.platform     process.platform
 * @param {number|null} facts.uid     process.getuid?.() (null on Windows)
 * @param {string|null} facts.procMounts  /proc/mounts text (Linux), else null
 * @returns {string[]}
 */
export function setupWarnings({ settings, platform, uid, procMounts }) {
  const out = [];
  if (uid === 0) {
    out.push(
      "the box is running as root — run it under its own standard account " +
        `(no sudo/admin); see ${SECURITY_GUIDE}`
    );
  }
  if (settings.livePort && !settings.certPath) {
    out.push(
      "the live view is plain HTTP on the venue Wi-Fi — set CERT_PATH so phones use HTTPS " +
        "(edge/README.md → HTTPS)"
    );
  }
  if (platform === "linux" && procHidesOthers(procMounts) === false) {
    out.push(
      "other accounts on this machine can read the camera passwords and stream keys in the " +
        `process list — mount /proc with hidepid=2 (${SECURITY_GUIDE})`
    );
  }
  return out;
}
