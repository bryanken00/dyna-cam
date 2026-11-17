/**
 * Fixtures used when `IS_DEMO` is on (see `constants/index.js`).
 *
 * Nothing here is reachable when demo mode is off — every consumer is behind
 * an `IS_DEMO` check in `services/requests/`.
 *
 * They mirror the API's responses — the `{ success, message, data }`
 * envelope and the shapes of `POST /api/v1/pair/app` and `/api/v1/app/*`
 * (back/server/src/controllers/v1/{pairing,app}/*.controller.js) — so the
 * hooks' `onSuccess` and the screens' unwraps need no demo branch.
 *
 * The demo: any 6-digit key pairs (000000 answers like a wrong key) to a
 * session on "Court 1" that started recording 3 minutes ago, with no live
 * video (there is no recorder box). Stop → Processing, its parts filling in,
 * → Ready after DEMO_SAVE_MS; then the 10-minute unpair countdown runs.
 */

/** Fake latency, so loading states are actually visible while developing. */
const DEMO_LATENCY_MS = 600;

/** Not a real token — demo mode sends it nowhere. */
const DEMO_TOKEN = "demo-device-token-not-real";

export const DEMO_WRONG_PAIRING_KEY = "000000";

/** Not a real host — demo links are for show and open nothing useful. */
const DEMO_APP_URL = "https://dynacam.example";

const DEMO_SAVE_MS = 8000;
const UNPAIR_GRACE_SECONDS = 10 * 60;
const SESSION_LENGTH_MS = 60 * 60000;
const PART_MS = 5 * 60000;

const pad2 = (n) => String(n).padStart(2, "0");

/** A Manila "YYYY-MM-DD HH:mm:ss" for an epoch time. */
const stampAt = (ms) => {
  const w = new Date(ms + 8 * 3600000);
  return `${w.getUTCFullYear()}-${pad2(w.getUTCMonth() + 1)}-${pad2(w.getUTCDate())} ${pad2(w.getUTCHours())}:${pad2(w.getUTCMinutes())}:${pad2(w.getUTCSeconds())}`;
};

/** The one demo session, (re)started by each demo pairing. */
let demoGame = null;

const startDemoGame = () => {
  const startMs = Date.now() - 3 * 60000;
  demoGame = { startMs, stopMs: startMs + SESSION_LENGTH_MS, endedMs: null };
};

/** The demo session as the API's AppSession. */
const demoSession = () => {
  const now = Date.now();
  const g = demoGame;
  // Ended by Stop, or by reaching its end time
  const endedMs = g.endedMs ?? (now >= g.stopMs ? g.stopMs : null);
  const lengthMs = Math.max(10000, (endedMs ?? now) - g.startMs);
  const partsTotal = Math.max(1, Math.ceil(lengthMs / PART_MS));

  let status = "Recording";
  let partsReady = Math.floor(lengthMs / PART_MS);
  if (endedMs) {
    const saved = (now - endedMs) / DEMO_SAVE_MS;
    status = saved >= 1 ? "Ready" : "Processing";
    partsReady =
      saved >= 1 ? partsTotal : Math.min(partsTotal - 1, Math.floor(saved * partsTotal));
  }

  return {
    session: {
      sessionId: "demo-session-1",
      courtId: "demo-court-1",
      courtName: "Court 1",
      venueName: "Dink City Pickleball",
      startAt: stampAt(g.startMs),
      endAt: stampAt(endedMs ?? g.stopMs),
      status,
      startsInSeconds: 0,
      elapsedSeconds: Math.floor(lengthMs / 1000),
      endsInSeconds: endedMs ? 0 : Math.floor((g.stopMs - now) / 1000),
      durationSeconds: Math.floor(lengthMs / 1000),
      partsReady,
      partsTotal,
      shareUrl: `${DEMO_APP_URL}/session/demo-share-1`,
      failureReason: null,
    },
    unpairInSeconds: endedMs
      ? Math.max(0, UNPAIR_GRACE_SECONDS - Math.floor((now - endedMs) / 1000))
      : null,
  };
};

const DEMO_DEVICE = { pairedAppId: "demo-device-1", name: "Court 1 device" };

/** POST /pair/app's `data` — and starts a fresh demo session. */
export const makeDemoPairing = () => {
  startDemoGame();
  return { token: DEMO_TOKEN, device: DEMO_DEVICE, session: demoSession().session };
};

/** GET /app/session's `data`. No recorder box in demo, so `live` is null. */
export const demoDeviceSession = () => {
  if (!demoGame) startDemoGame(); // a demo pairing restored after a restart
  return { ...demoSession(), live: null, device: DEMO_DEVICE };
};

/** POST /app/session/stop → its `data`, or null when it isn't recording. */
export const demoStopSession = () => {
  if (!demoGame) startDemoGame();
  if (demoSession().session.status !== "Recording") return null;
  // The API keeps at least 10 seconds of footage
  demoGame.endedMs = Math.max(Date.now(), demoGame.startMs + 10000);
  const { session, unpairInSeconds } = demoSession();
  return { session, unpairInSeconds };
};

/** Wraps a payload in the API's response envelope. */
export const demoEnvelope = (message, data = null) => ({
  success: true,
  message,
  data,
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

/** Resolves after DEMO_LATENCY_MS — keeps demo calls async like real ones. */
export const demoDelay = () =>
  new Promise((resolve) => setTimeout(resolve, DEMO_LATENCY_MS));
