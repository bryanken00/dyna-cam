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
 *
 * The player's stream: a stream-link "is used" by the player 6 s after it is
 * made — the session then reports a Facebook stream "starting", "live" 5 s
 * later. Stop streaming (or the session ending) clears it.
 *
 * CR-013 saves: "Save the last N min" works after the first minute, up to 5
 * at once; each is made in turn — "Queued", then "Saving" with a rising
 * percent for DEMO_CAPTURE_MS, then "Ready". Saves can be deleted.
 *
 * CR-015 payment: the game is Unpaid (code DEMO_PAY_CODE, no download link)
 * until "staff record the payment" DEMO_PAID_MS after End game. Find a game:
 * DEMO_PAY_CODE finds the demo game (paid once that has happened); any other
 * code answers "No game has that code".
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
const STREAM_LINK_SECONDS = 15 * 60;
const DEMO_STREAM_SAVED_MS = 6000; // the "player" pastes their key
const DEMO_STREAM_LIVE_MS = 5000; // then the box gets it live
const DEMO_CAPTURE_MS = 7000; // a save "copies and uploads"
const CAPTURE_MIN_SECONDS = 60;
const CAPTURE_MAX_PER_GAME = 5;
const CAPTURE_REPEAT_MS = 3000; // a double tap returns the save already made
const DEMO_PAID_MS = 15000; // CR-015: "staff record the payment" after End game
export const DEMO_PAY_CODE = "K7QM2P";

const pad2 = (n) => String(n).padStart(2, "0");

/** A Manila "YYYY-MM-DD HH:mm:ss" for an epoch time. */
const stampAt = (ms) => {
  const w = new Date(ms + 8 * 3600000);
  return `${w.getUTCFullYear()}-${pad2(w.getUTCMonth() + 1)}-${pad2(w.getUTCDate())} ${pad2(w.getUTCHours())}:${pad2(w.getUTCMinutes())}:${pad2(w.getUTCSeconds())}`;
};

/** The one demo session, (re)started by each demo pairing. */
let demoGame = null;

const startDemoGame = () => {
  // CR-005: pairing starts the game — the demo starts at 0:00 like a real one
  const startMs = Date.now();
  demoGame = {
    startMs,
    stopMs: startMs + SESSION_LENGTH_MS,
    endedMs: null,
    streamSavedMs: null, // when the "player" saved the current stream
    streamPendingMs: null, // when a new link's "player" will save one
    captures: [], // CR-013: { id, savedMs, fromSeconds, toSeconds, deleted }
  };
};

/** The demo session's player stream, as GET /app/session's `stream`. */
const demoStream = (ended) => {
  // A link's "player" saving their key replaces the current stream
  if (demoGame.streamPendingMs && demoGame.streamPendingMs <= Date.now()) {
    demoGame.streamSavedMs = demoGame.streamPendingMs;
    demoGame.streamPendingMs = null;
  }
  const savedMs = demoGame.streamSavedMs;
  if (!savedMs || ended) return null;
  const live = Date.now() - savedMs >= DEMO_STREAM_LIVE_MS;
  return {
    platform: "FACEBOOK",
    status: live ? "live" : "starting",
    message: null,
    maskedUrl: "rtmps://live-api-s.facebook.com:443/rtmp/••••a1b2",
    updatedAt: stampAt(live ? savedMs + DEMO_STREAM_LIVE_MS : savedMs),
  };
};

/** CR-015: has "staff" recorded the demo game's payment yet? */
const demoPaid = () =>
  Boolean(demoGame?.endedMs) && Date.now() - demoGame.endedMs >= DEMO_PAID_MS;

/**
 * CR-015: GET /public/games/:payCode's `data` (Find a game), or null when no
 * game has that code.
 */
export const demoFindGame = (payCode) => {
  if (payCode !== DEMO_PAY_CODE) return null;
  const paid = demoPaid();
  const startMs = demoGame?.startMs ?? Date.now() - 45 * 60000;
  return {
    game: {
      courtName: "Court 1",
      venueName: "Dink City Pickleball",
      startAt: stampAt(startMs),
      endAt: stampAt(demoGame?.endedMs ?? startMs + 40 * 60000),
      status: "Ready",
      paymentStatus: paid ? "Paid" : "Unpaid",
      paid,
      shareUrl: paid ? `${DEMO_APP_URL}/session/demo-share-1` : null,
    },
  };
};

/** The demo session as the API's AppSession. */
const demoSession = () => {
  const now = Date.now();
  const g = demoGame;
  // CR-005: an open game ends only with End game (no end time)
  const endedMs = g.endedMs ?? null;
  const lengthMs = Math.max(10000, (endedMs ?? now) - g.startMs);

  let status = "Recording";
  if (endedMs) {
    // CR-006: the game's file "uploads" over DEMO_SAVE_MS, then it's Ready
    status = now - endedMs >= DEMO_SAVE_MS ? "Ready" : "Processing";
  }

  return {
    session: {
      sessionId: "demo-session-1",
      courtId: "demo-court-1",
      courtName: "Court 1",
      venueName: "Dink City Pickleball",
      startAt: stampAt(g.startMs),
      endAt: stampAt(endedMs ?? g.stopMs), // a placeholder while open, as the API's
      openEnded: !endedMs,
      status,
      startsInSeconds: 0,
      elapsedSeconds: Math.floor(lengthMs / 1000),
      endsInSeconds: 0,
      durationSeconds: Math.floor(lengthMs / 1000),
      // CR-006: the game's file uploads after End game
      uploadPercent: endedMs ? Math.min(100, Math.floor(((now - endedMs) / DEMO_SAVE_MS) * 100)) : null,
      // CR-015: the download link only once the game is paid at the desk
      shareUrl: demoPaid() ? `${DEMO_APP_URL}/session/demo-share-1` : null,
      payment: demoPaid()
        ? { status: "Paid", payCode: null }
        : { status: "Unpaid", payCode: DEMO_PAY_CODE },
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

/**
 * CR-013: the demo game's saves, as GET /app/session's `captures`. Made one
 * at a time like the real box: each starts when the one before is ready.
 */
const demoCaptures = () => {
  let freeAt = 0; // when the "box" is free for the next save
  return demoGame.captures
    .filter((capture) => !capture.deleted)
    .map((capture, i) => {
      const startMs = Math.max(capture.savedMs, freeAt);
      freeAt = startMs + DEMO_CAPTURE_MS;
      const now = Date.now();
      const queued = now < startMs;
      const ready = now >= freeAt;
      return {
        captureId: capture.id,
        number: i + 1,
        fromSeconds: capture.fromSeconds,
        toSeconds: capture.toSeconds,
        seconds: capture.toSeconds - capture.fromSeconds,
        savedAt: stampAt(capture.savedMs),
        status: ready ? "Ready" : queued ? "Queued" : "Saving",
        uploadPercent: ready
          ? 100
          : queued
            ? null
            : Math.min(99, Math.floor(((now - startMs) / DEMO_CAPTURE_MS) * 100)),
        videos: [],
      };
    });
};

const demoLiveCaptures = () => demoGame.captures.filter((capture) => !capture.deleted);

/** GET /app/session's `data`. No recorder box in demo, so `live` is null. */
export const demoDeviceSession = () => {
  if (!demoGame) startDemoGame(); // a demo pairing restored after a restart
  const data = demoSession();
  return {
    ...data,
    live: null,
    device: DEMO_DEVICE,
    stream: demoStream(data.unpairInSeconds != null),
    capture: {
      minSeconds: CAPTURE_MIN_SECONDS,
      available: data.session.status === "Recording",
      maxPerGame: CAPTURE_MAX_PER_GAME,
      used: demoLiveCaptures().length,
    },
    captures: demoCaptures(),
  };
};

/**
 * POST /app/session/captures → `{ data }` or `{ error: [status, message, code] }`,
 * with the API's refusals (not recording, first minute, cooldown).
 */
export const demoSaveCapture = (seconds) => {
  if (!demoGame) startDemoGame();
  const { session } = demoSession();
  if (session.status !== "Recording") {
    return { error: [409, "The game isn't recording, so there's nothing to save.", "NOT_RECORDING"] };
  }
  if (session.elapsedSeconds < CAPTURE_MIN_SECONDS) {
    return { error: [409, "You can save once the first minute has been played.", "TOO_EARLY"] };
  }
  const live = demoLiveCaptures();
  const last = live[live.length - 1];
  if (last && last.seconds === seconds && Date.now() - last.savedMs < CAPTURE_REPEAT_MS) {
    return { data: { ...demoDeviceSession(), captureId: last.id } };
  }
  if (live.length >= CAPTURE_MAX_PER_GAME) {
    return {
      error: [409, "This game already has its saves — delete one to save another.", "TOO_MANY"],
    };
  }
  const toSeconds = session.elapsedSeconds;
  const id = `demo-capture-${demoGame.captures.length + 1}`;
  demoGame.captures.push({
    id,
    savedMs: Date.now(),
    seconds,
    fromSeconds: Math.max(0, toSeconds - seconds),
    toSeconds,
    deleted: false,
  });
  return { data: { ...demoDeviceSession(), captureId: id } };
};

/** DELETE /app/session/captures/:id → its `data`, or null when there is no such save. */
export const demoDeleteCapture = (captureId) => {
  if (!demoGame) startDemoGame();
  const capture = demoLiveCaptures().find((item) => item.id === captureId);
  if (!capture) return null;
  capture.deleted = true;
  return demoDeviceSession();
};

/**
 * POST /app/session/stream-link → its `data`, or null once the session has
 * ended (the API's 409). The "player" uses it DEMO_STREAM_SAVED_MS later.
 */
export const demoStreamLink = () => {
  if (!demoGame) startDemoGame();
  if (demoSession().unpairInSeconds != null) return null;
  demoGame.streamPendingMs = Date.now() + DEMO_STREAM_SAVED_MS;
  const code = Math.random().toString(36).slice(2, 10);
  return {
    url: `${DEMO_APP_URL}/stream/${code}`,
    expiresAt: stampAt(Date.now() + STREAM_LINK_SECONDS * 1000),
    expiresInSeconds: STREAM_LINK_SECONDS,
  };
};

/** POST /app/session/stream/stop. */
export const demoStopStream = () => {
  if (demoGame) {
    demoGame.streamSavedMs = null;
    demoGame.streamPendingMs = null;
  }
  return { stream: null };
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
