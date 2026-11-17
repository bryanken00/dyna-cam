/**
 * Fixtures used when `IS_DEMO` is on (see `constants/index.js`).
 *
 * Nothing here is reachable when demo mode is off — every consumer is behind
 * an `IS_DEMO` check in `services/requests/`.
 *
 * The fixtures mirror the real API's responses (the `{ success, message, data }`
 * envelope, the `user` object from POST /api/v1/admin/auth/login, and the row
 * shapes of the Dyna Cam admin controllers), so the hooks' `onSuccess` and
 * the module hooks' unwraps need no demo branch.
 */

/** Fake latency, so loading states are actually visible while developing. */
export const DEMO_LATENCY_MS = 600;

/** Not real credentials — demo mode never sends them anywhere. */
export const DEMO_TOKEN = "demo-token-not-a-real-jwt";
export const DEMO_REFRESH_TOKEN = "demo-refresh-token-not-a-real-jwt";

/**
 * Shaped like the `user` the API returns on login and from GET /auth/me.
 *
 * @param {string} email - whatever was typed on the login form
 */
export const makeDemoUser = (email) => ({
  accountId: "demo-user-1",
  firstName: "Demo",
  lastName: "User",
  email: email || "demo@example.com",
  roleId: "demo-role",
  roleName: "Demo",
  status: "Active",
  type: "ADMIN",
  mustChangePassword: false,
});

/** A session payload shaped like the API's (login, refresh, change-password). */
export const makeDemoSession = () => ({
  token: DEMO_TOKEN,
  accessToken: { token: DEMO_TOKEN },
  refreshToken: { token: DEMO_REFRESH_TOKEN },
});

/** Wraps a payload in the API's response envelope. */
export const demoEnvelope = (message, data = null) => ({
  success: true,
  message,
  data,
});

/**
 * One page of fixture rows in the API's list envelope:
 * `{ success, message, data: { [key]: rows, pagination } }`. Callers filter
 * first, the way the server's WHERE clause would.
 */
export const demoPage = (key, message, rows, { page = 1, pageSize = 20 } = {}) =>
  demoEnvelope(message, {
    [key]: rows.slice((page - 1) * pageSize, page * pageSize),
    pagination: {
      page,
      pageSize,
      total: rows.length,
      totalPages: Math.ceil(rows.length / pageSize),
    },
  });

/**
 * An error shaped like the one axios rejects with for an API error, so
 * `error.response?.data?.message` and `.code` read the same in demo mode.
 */
export const demoError = (status, message, code) => {
  const error = new Error(message);
  error.response = { status, data: { success: false, message, code } };
  return error;
};

/** Resolves after DEMO_LATENCY_MS — keeps demo mutations async like real ones. */
export const demoDelay = () =>
  new Promise((resolve) => setTimeout(resolve, DEMO_LATENCY_MS));

// ─────────────────────────────────────────────────────────────────────────────
// Dyna Cam fixtures — rows shaped exactly like the admin controllers' (see
// back/server/src/controllers/v1/admin/{courts,devices,clips,sessions}.controller.js).
// Timestamps are Manila wall-clock strings relative to when the app started,
// so "today" and "recording now" stay true in a demo.
// ─────────────────────────────────────────────────────────────────────────────

const pad2 = (n) => String(n).padStart(2, "0");

/** Manila "YYYY-MM-DD HH:mm:ss", `minutes` from now (negative = ago). */
const demoStamp = (minutes) => {
  const w = new Date(Date.now() + minutes * 60000 + 8 * 3600000);
  return `${w.getUTCFullYear()}-${pad2(w.getUTCMonth() + 1)}-${pad2(w.getUTCDate())} ${pad2(w.getUTCHours())}:${pad2(w.getUTCMinutes())}:00`;
};

/** Not a real host — demo links are for show and open nothing useful. */
const DEMO_APP_URL = "https://dynacam.example";

/**
 * Every Dyna Cam permission at write level, so demo mode shows every screen
 * and action. Same row shape as GET /api/v1/admin/permissions/user.
 */
export const DEMO_PERMISSIONS = [
  ["venues", "list"],
  ["venues", "courts"],
  ["venues", "devices"],
  ["clips", null],
  ["payments", null],
  ["dashboard", null],
].map(([module, submodule]) => ({
  permissionId: `demo-perm-${module}-${submodule ?? "all"}`,
  module,
  submodule,
  description: null,
  accessLevel: "write",
  source: "role",
}));

export const DEMO_VENUES = [
  { venueId: "demo-venue-1", name: "Dink City Pickleball", status: "Active" },
  { venueId: "demo-venue-2", name: "Baseline Courts", status: "Active" },
];

const demoCourt = (courtId, venue, name, extra = {}) => ({
  courtId,
  venueId: venue.venueId,
  venueName: venue.name,
  venueLogoUrl: null,
  name,
  qrToken: `${courtId}-qr`,
  qrUrl: `${DEMO_APP_URL}/court/${courtId}-qr`,
  buttonCode: null,
  status: "Active",
  recorderOnline: true,
  camera: { configured: true, display: "rtsp://camera:554/stream1" },
  stream: { enabled: false, configured: false, display: null, watchUrl: null },
  dateCreated: demoStamp(-60 * 24 * 30),
  dateUpdated: demoStamp(-60 * 24),
  ...extra,
});

export const DEMO_COURTS = [
  demoCourt("demo-court-1", DEMO_VENUES[0], "Court 1", {
    buttonCode: "dink-city-court-1",
  }),
  demoCourt("demo-court-2", DEMO_VENUES[0], "Court 2", {
    buttonCode: "dink-city-court-2",
    stream: {
      enabled: true,
      configured: true,
      display: "rtmp://…/live2/••••a1b2",
      watchUrl: null,
    },
  }),
  demoCourt("demo-court-3", DEMO_VENUES[0], "Court 3", {
    camera: { configured: false, display: null },
  }),
  demoCourt("demo-court-4", DEMO_VENUES[1], "Center Court", {
    recorderOnline: false,
  }),
];

export const DEMO_DEVICES = [
  {
    deviceId: "demo-device-1",
    venueId: DEMO_VENUES[0].venueId,
    venueName: DEMO_VENUES[0].name,
    name: "Front desk box",
    status: "Active",
    lastSeenAt: demoStamp(0),
    lastSeenSecondsAgo: 12,
    agentVersion: "1.0.0",
    online: true,
    cameras: [
      { courtId: "demo-court-1", courtName: "Court 1", status: "ok", message: null },
      { courtId: "demo-court-2", courtName: "Court 2", status: "starting", message: "Connecting to the camera" },
    ],
    dateCreated: demoStamp(-60 * 24 * 30),
    dateUpdated: demoStamp(-60),
  },
  {
    deviceId: "demo-device-2",
    venueId: DEMO_VENUES[1].venueId,
    venueName: DEMO_VENUES[1].name,
    name: "Baseline box",
    status: "Active",
    lastSeenAt: demoStamp(-75),
    lastSeenSecondsAgo: 75 * 60,
    agentVersion: null,
    online: false,
    cameras: [],
    dateCreated: demoStamp(-60 * 24 * 10),
    dateUpdated: demoStamp(-60 * 24),
  },
];

const demoClip = (n, court, minutesAgo, extra = {}) => ({
  clipId: `demo-clip-${n}`,
  venueId: court.venueId,
  venueName: court.venueName,
  courtId: court.courtId,
  courtName: court.name,
  source: "QR",
  sessionId: null,
  partIndex: null,
  requestedAt: demoStamp(-minutesAgo),
  durationSeconds: 60,
  price: 0,
  paymentStatus: "Free",
  payCode: null,
  sizeBytes: 18500000,
  failureReason: null,
  expiresAt: demoStamp(60 * 24 * 7 - minutesAgo),
  status: "Ready",
  dateCreated: demoStamp(-minutesAgo),
  dateUpdated: demoStamp(-minutesAgo),
  shareUrl: `${DEMO_APP_URL}/clip/demo-share-${n}`,
  // No demo video or thumbnail exists, so the screens show their placeholders
  videoUrl: null,
  downloadUrl: null,
  thumbnailUrl: null,
  ...extra,
});

export const DEMO_CLIPS = [
  demoClip(1, DEMO_COURTS[0], 3, { status: "Processing", sizeBytes: null }),
  demoClip(2, DEMO_COURTS[0], 25, {
    price: 50,
    paymentStatus: "Unpaid",
    payCode: "K7QM2P",
  }),
  demoClip(3, DEMO_COURTS[1], 48, { source: "BUTTON" }),
  demoClip(4, DEMO_COURTS[1], 95, {
    source: "STAFF",
    price: 50,
    paymentStatus: "Paid",
    payCode: "H3XR9A",
  }),
  demoClip(5, DEMO_COURTS[3], 180, {
    status: "Failed",
    sizeBytes: null,
    failureReason: "The recorder box was offline",
  }),
  demoClip(6, DEMO_COURTS[0], 60 * 26, { source: "SESSION", sessionId: "demo-session-3", partIndex: 0 }),
  demoClip(7, DEMO_COURTS[1], 60 * 24 * 9, { status: "Expired", sizeBytes: null }),
];

const demoSession = (n, court, startMinutes, durationMinutes, extra = {}) => ({
  sessionId: `demo-session-${n}`,
  venueId: court.venueId,
  venueName: court.venueName,
  courtId: court.courtId,
  courtName: court.name,
  startAt: demoStamp(startMinutes),
  endAt: demoStamp(startMinutes + durationMinutes),
  playerName: null,
  phone: null,
  status: "Scheduled",
  failureReason: null,
  dateCreated: demoStamp(-60 * 24),
  dateUpdated: demoStamp(-60),
  durationMinutes,
  partsTotal: Math.ceil(durationMinutes / 5),
  partsReady: 0,
  shareUrl: `${DEMO_APP_URL}/session/demo-session-share-${n}`,
  ...extra,
});

export const DEMO_SESSIONS = [
  demoSession(1, DEMO_COURTS[1], -20, 60, {
    status: "Recording",
    playerName: "Marco Reyes",
    phone: "0912 3456 789",
    partsReady: 3,
  }),
  demoSession(2, DEMO_COURTS[0], 90, 120, { playerName: "Ana Santos" }),
  demoSession(3, DEMO_COURTS[0], -60 * 27, 60, {
    status: "Ready",
    partsReady: 12,
  }),
  demoSession(4, DEMO_COURTS[3], -60 * 50, 90, { status: "Cancelled" }),
];

// ─────────────────────────────────────────────────────────────────────────────
// Paired phone fixtures (PLAN-002) — shaped like /api/v1/pair/app and
// /api/v1/app/* (back/server/src/controllers/v1/{pairing,app}/*.controller.js).
// In demo mode any 6-digit key pairs, except 000000, which answers like a
// wrong key so the error state can be seen.
// ─────────────────────────────────────────────────────────────────────────────

export const DEMO_WRONG_PAIRING_KEY = "000000";

/** POST /pair/app's `data`. Not a real token — demo mode sends it nowhere. */
export const makeDemoPairing = () => ({
  token: "demo-paired-token-not-real",
  pairedApp: { pairedAppId: "demo-phone-1", name: "Front desk phone" },
  venue: { venueId: DEMO_VENUES[0].venueId, name: DEMO_VENUES[0].name },
});

/** The paired venue's courts, as GET /app/courts returns them. */
export const demoPairedCourts = () =>
  DEMO_COURTS.filter((c) => c.venueId === DEMO_VENUES[0].venueId).map((c) => ({
    courtId: c.courtId,
    name: c.name,
    hasCamera: Boolean(c.camera?.configured),
    recorderOnline: c.recorderOnline,
    canRecord: Boolean(c.camera?.configured) && c.recorderOnline,
    recording: demoRecordingOn(c.courtId),
  }));

/** An admin clip fixture → the paired API's clip shape (toAppClip). */
export const toDemoAppClip = (clip, { alwaysPayCode = false } = {}) => ({
  clipId: clip.clipId,
  courtId: clip.courtId,
  courtName: clip.courtName,
  source: clip.source,
  requestedAt: clip.requestedAt,
  durationSeconds: clip.durationSeconds,
  status: clip.status === "Processing" ? "Pending" : clip.status,
  shareUrl: clip.shareUrl,
  thumbnailUrl: clip.thumbnailUrl,
  price: clip.price,
  paymentStatus: clip.paymentStatus,
  payCode:
    alwaysPayCode || clip.paymentStatus === "Unpaid" ? clip.payCode : null,
});

/**
 * Clips "recorded" in this demo session: Pending for a few seconds, then
 * Ready — so the QR screen's Saving… → Ready switch can be seen.
 */
const demoRecordings = new Map();
const DEMO_SAVE_MS = 6000;

export const demoRecordClip = (court) => {
  const n = demoRecordings.size + 1;
  const clipId = `demo-recording-${n}`;
  const w = new Date(Date.now() + 8 * 3600000);
  demoRecordings.set(clipId, {
    at: Date.now(),
    clip: {
      clipId,
      courtId: court.courtId,
      courtName: court.name,
      source: "STAFF",
      requestedAt: `${w.getUTCFullYear()}-${pad2(w.getUTCMonth() + 1)}-${pad2(w.getUTCDate())} ${pad2(w.getUTCHours())}:${pad2(w.getUTCMinutes())}:00`,
      durationSeconds: 60,
      shareUrl: `${DEMO_APP_URL}/clip/demo-recording-${n}`,
      thumbnailUrl: null,
      price: 0,
      paymentStatus: "Free",
      payCode: null,
    },
  });
  return demoRecordings.get(clipId).clip;
};

/** A paired-API clip by ID: a demo recording (with its live status) or a fixture. */
export const demoAppClip = (clipId) => {
  const rec = demoRecordings.get(clipId);
  if (rec) {
    return {
      ...rec.clip,
      status: Date.now() - rec.at > DEMO_SAVE_MS ? "Ready" : "Pending",
    };
  }
  const clip = DEMO_CLIPS.find((c) => c.clipId === clipId);
  return clip ? toDemoAppClip(clip) : null;
};

/** A court's recent clips: this session's recordings first, then fixtures. */
export const demoCourtClips = (courtId) => [
  ...[...demoRecordings.keys()]
    .reverse()
    .map(demoAppClip)
    .filter((c) => c.courtId === courtId),
  // Session parts are games' footage, not 60-second clips — the API leaves them out
  ...DEMO_CLIPS.filter((c) => c.courtId === courtId && c.source !== "SESSION").map(
    (c) => toDemoAppClip(c),
  ),
];

// ── Whole-game recording (PLAN-002 Phase D) ──────────────────────────────────
// Start creates a running game; End turns it Processing, with parts becoming
// ready one by one, then Ready after DEMO_GAME_SAVE_MS. Court 2 starts out
// already recording (started by a staff member 12 minutes before launch).

const DEMO_GAME_MAX_MS = 3 * 3600000;
const DEMO_GAME_SAVE_MS = 8000;
const PART_MS = 5 * 60000;

/** A Manila "YYYY-MM-DD HH:mm:ss" for an epoch time. */
const stampAt = (ms) => {
  const w = new Date(ms + 8 * 3600000);
  return `${w.getUTCFullYear()}-${pad2(w.getUTCMonth() + 1)}-${pad2(w.getUTCDate())} ${pad2(w.getUTCHours())}:${pad2(w.getUTCMinutes())}:${pad2(w.getUTCSeconds())}`;
};

/** sessionId → { courtId, courtName, startMs, stopMs, endedMs, startedBy } */
const demoGames = new Map();
const demoRunning = new Map(); // courtId → sessionId

const addDemoGame = (court, startedBy, startMs = Date.now()) => {
  const sessionId = `demo-game-${demoGames.size + 1}`;
  demoGames.set(sessionId, {
    sessionId,
    courtId: court.courtId,
    courtName: court.name,
    startMs,
    stopMs: startMs + DEMO_GAME_MAX_MS,
    endedMs: null,
    startedBy,
  });
  demoRunning.set(court.courtId, sessionId);
  return sessionId;
};

addDemoGame(DEMO_COURTS[1], "Ana (staff)", Date.now() - 12 * 60000);

/** A running game's AppRecording (GET /courts' `recording`), or null. */
export const demoRecordingOn = (courtId) => {
  const game = demoGames.get(demoRunning.get(courtId));
  if (!game) return null;
  const now = Date.now();
  if (now >= game.stopMs) {
    // Stopped by itself at its automatic end
    game.endedMs = game.stopMs;
    demoRunning.delete(courtId);
    return null;
  }
  return {
    sessionId: game.sessionId,
    startAt: stampAt(game.startMs),
    endAt: stampAt(game.stopMs),
    elapsedSeconds: Math.floor((now - game.startMs) / 1000),
    endsInSeconds: Math.floor((game.stopMs - now) / 1000),
    startedBy: game.startedBy,
  };
};

/** A demo game as the API's AppSession. */
export const demoAppSession = (sessionId) => {
  const game = demoGames.get(sessionId);
  if (!game) return null;
  const now = Date.now();
  const endMs = game.endedMs ?? game.stopMs;
  const durationMs = Math.max(10000, (game.endedMs ?? now) - game.startMs);
  const partsTotal = Math.max(1, Math.ceil(durationMs / PART_MS));
  let status = "Recording";
  let partsReady = Math.floor(durationMs / PART_MS); // finished parts so far
  if (game.endedMs) {
    const saving = (now - game.endedMs) / DEMO_GAME_SAVE_MS;
    status = saving >= 1 ? "Ready" : "Processing";
    partsReady = saving >= 1 ? partsTotal : Math.min(partsTotal - 1, Math.floor(saving * partsTotal));
  }
  return {
    sessionId,
    courtId: game.courtId,
    courtName: game.courtName,
    startAt: stampAt(game.startMs),
    endAt: stampAt(endMs),
    durationSeconds: Math.round(durationMs / 1000),
    status,
    partsReady,
    partsTotal,
    shareUrl: `${DEMO_APP_URL}/session/${sessionId}`,
    failureReason: null,
    startedBy: game.startedBy,
  };
};

/**
 * Start a game on a court; an already-running one is returned as-is (the
 * API's 200 "Already recording"). → { recording, already }
 */
export const demoStartRecording = (court, startedBy) => {
  const running = demoRecordingOn(court.courtId);
  if (running) {
    return { recording: { ...running, shareUrl: demoAppSession(running.sessionId).shareUrl }, already: true };
  }
  const sessionId = addDemoGame(court, startedBy);
  return {
    recording: { ...demoRecordingOn(court.courtId), shareUrl: demoAppSession(sessionId).shareUrl },
    already: false,
  };
};

/** End a court's game → its AppSession, or null if it wasn't recording. */
export const demoEndRecording = (courtId) => {
  const game = demoGames.get(demoRunning.get(courtId));
  if (!game) return null;
  // The API keeps at least 10 seconds of footage
  game.endedMs = Math.max(Date.now(), game.startMs + 10000);
  demoRunning.delete(courtId);
  return demoAppSession(game.sessionId);
};

/** A court's games, newest first: this session's demo games. */
export const demoCourtSessions = (courtId) =>
  [...demoGames.values()]
    .filter((g) => g.courtId === courtId)
    .sort((a, b) => b.startMs - a.startMs)
    .map((g) => demoAppSession(g.sessionId));
