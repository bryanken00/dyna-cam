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
