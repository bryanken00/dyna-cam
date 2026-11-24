import { DEVICE_ONLINE_SECONDS, secondsAgoLocal } from "./clips.js";

/**
 * CR-008: venue health from the recorder boxes' heartbeats.
 *
 * `findProblems()` lists what is wrong right now — the venue-alerts job
 * (jobs/venueAlerts.js) turns that into Pending → Open → Resolved rows in
 * `venue_alerts` and tells staff (Discord, email). The Dashboard uses `boxHealth()` for the
 * boxes and cameras it shows.
 */

const envNumber = (name, fallback, min) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= min ? value : fallback;
};

/** Thresholds, from the API's .env (read on each call so tests can change them). */
export const alertSettings = () => ({
  // A problem has to last this long before anyone is emailed
  graceMinutes: envNumber("ALERT_GRACE_MINUTES", 4, 0),
  diskFreePercent: envNumber("ALERT_DISK_FREE_PERCENT", 10, 0),
  clockMs: envNumber("ALERT_CLOCK_MS", 2000, 100),
  backlogMinutes: envNumber("ALERT_BACKLOG_MINUTES", 60, 1),
});

export const ALERT_KINDS = [
  "BOX_OFFLINE",
  "CAMERA_DOWN",
  "DISK_LOW",
  "CLOCK_OFF",
  "UPLOAD_BACKLOG",
  "BOX_OUTDATED",
];

/** Short labels for emails and the Dashboard. */
export const ALERT_LABELS = {
  BOX_OFFLINE: "Recorder box offline",
  CAMERA_DOWN: "Camera not recording",
  DISK_LOW: "Disk almost full",
  CLOCK_OFF: "Box clock is off",
  UPLOAD_BACKLOG: "Uploads piling up",
  BOX_OUTDATED: "Recorder box needs updating",
};

/** The stored heartbeat (JSON column or string) as an object, {} when unreadable. */
export const parseStatus = (value) => {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value) || {};
  } catch {
    return {};
  }
};

const minutesText = (seconds) => {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
};

/**
 * Problems a box's heartbeat shows. Pure, so it is unit-tested directly.
 *
 * @param {object} box      { deviceId, venueId, name, online }
 * @param {object} status   the parsed `devices.lastStatus`
 * @param {Map<string, string>} courts courtId → name, the venue's courts still in use
 * @param {ReturnType<typeof alertSettings>} settings
 * @returns {object[]} { alertKey, kind, venueId, deviceId, courtId, camera, message }
 */
export const boxProblems = (box, status, courts, settings) => {
  const base = { venueId: box.venueId, deviceId: box.deviceId, courtId: null, camera: null };
  if (!box.online) {
    return [
      {
        ...base,
        kind: "BOX_OFFLINE",
        alertKey: `BOX_OFFLINE:${box.deviceId}`,
        message: `${box.name} has stopped sending heartbeats`,
      },
    ];
  }

  const problems = [];
  for (const entry of Array.isArray(status.cameras) ? status.cameras : []) {
    if (!courts.has(entry?.courtId) || entry.status === "ok") continue;
    const camera = entry.camera === 2 ? 2 : 1;
    const why = entry.message ? `: ${entry.message}` : "";
    problems.push({
      ...base,
      courtId: entry.courtId,
      camera,
      kind: "CAMERA_DOWN",
      alertKey: `CAMERA_DOWN:${box.deviceId}:${entry.courtId}:${camera}`,
      message: `${courts.get(entry.courtId)} · Cam ${camera} is not recording${why}`.slice(0, 255),
    });
  }

  const system = status.system || {};
  if (
    Number.isFinite(system.diskFreeMb) &&
    Number.isFinite(system.diskTotalMb) &&
    system.diskTotalMb > 0 &&
    (system.diskFreeMb / system.diskTotalMb) * 100 < settings.diskFreePercent
  ) {
    const percent = Math.round((system.diskFreeMb / system.diskTotalMb) * 100);
    problems.push({
      ...base,
      kind: "DISK_LOW",
      alertKey: `DISK_LOW:${box.deviceId}`,
      message: `${box.name} has ${percent}% disk left (${(system.diskFreeMb / 1024).toFixed(1)} GB)`,
    });
  }
  if (Number.isFinite(system.clockOffsetMs) && Math.abs(system.clockOffsetMs) > settings.clockMs) {
    const seconds = (Math.abs(system.clockOffsetMs) / 1000).toFixed(1);
    const way = system.clockOffsetMs > 0 ? "behind" : "ahead of";
    problems.push({
      ...base,
      kind: "CLOCK_OFF",
      alertKey: `CLOCK_OFF:${box.deviceId}`,
      message: `${box.name}'s clock is ${seconds}s ${way} the server — clips will be cut at the wrong moment`,
    });
  }
  // CR-040 Phase 4: only a box that sends games straight to Google Drive gets them
  const capabilities = Array.isArray(status.capabilities) ? status.capabilities : [];
  if (!capabilities.includes("drive-direct")) {
    problems.push({
      ...base,
      kind: "BOX_OUTDATED",
      alertKey: `BOX_OUTDATED:${box.deviceId}`,
      message: `${box.name} needs updating — its games wait until it can send them to Google Drive`,
    });
  }
  if (
    Number.isFinite(system.oldestPendingSeconds) &&
    system.oldestPendingSeconds > settings.backlogMinutes * 60
  ) {
    const waiting = (system.pendingClips || 0) + (system.pendingGames || 0);
    problems.push({
      ...base,
      kind: "UPLOAD_BACKLOG",
      alertKey: `UPLOAD_BACKLOG:${box.deviceId}`,
      message: `${box.name} has ${waiting} clip(s)/game video(s) unsent, the oldest for ${minutesText(system.oldestPendingSeconds)}`,
    });
  }
  return problems;
};

/**
 * Every Active recorder box that has ever sent a heartbeat, with its venue's
 * courts in use. A box that never did isn't set up yet, so it can't be "down".
 */
export const boxHealth = async (db) => {
  const onlineSince = secondsAgoLocal(DEVICE_ONLINE_SECONDS);
  const boxes = await db.query(
    `SELECT d.deviceId, d.venueId, d.name, d.lastSeenAt, d.lastStatus, d.agentVersion,
            v.name AS venueName
     FROM devices d
     JOIN venues v ON v.venueId = d.venueId AND v.status != 'Deleted'
     WHERE d.status = 'Active' AND d.lastSeenAt IS NOT NULL
     ORDER BY v.name, d.name`
  );
  const courtRows = await db.query(
    `SELECT courtId, venueId, name FROM courts WHERE status = 'Active'`
  );
  const courtsByVenue = new Map();
  for (const court of courtRows) {
    if (!courtsByVenue.has(court.venueId)) courtsByVenue.set(court.venueId, new Map());
    courtsByVenue.get(court.venueId).set(court.courtId, court.name);
  }
  return boxes.map((box) => ({
    ...box,
    online: box.lastSeenAt >= onlineSince,
    status: parseStatus(box.lastStatus),
    courts: courtsByVenue.get(box.venueId) || new Map(),
  }));
};

/**
 * What is wrong right now across every venue.
 *
 * @returns {Promise<{ problems: object[], offlineDevices: Set<string>, knownDevices: Set<string> }>}
 *   offlineDevices: boxes whose camera/disk/clock state is unknown while they
 *   are offline — their other alerts are left as they are, not resolved.
 *   knownDevices: every box still in use; alerts of any other box are closed.
 */
export const findProblems = async (db, settings = alertSettings()) => {
  const boxes = await boxHealth(db);
  const problems = [];
  const offlineDevices = new Set();
  const knownDevices = new Set();
  for (const box of boxes) {
    knownDevices.add(box.deviceId);
    if (!box.online) offlineDevices.add(box.deviceId);
    problems.push(...boxProblems(box, box.status, box.courts, settings));
  }
  return { problems, offlineDevices, knownDevices };
};
