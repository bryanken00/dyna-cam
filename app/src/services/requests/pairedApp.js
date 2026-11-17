/**
 * Request hooks — Paired staff phone (PLAN-002)
 *
 * Side effects live here: the pairing store write, toasts and cache
 * invalidation. Screens and their hooks import from this file, never from
 * api/. Query keys all start with "paired", so Navigation can drop them all
 * when the phone is unpaired.
 *
 * ── Staying paired ──────────────────────────────────────────────────────────
 * Only a 401 TOKEN_INVALID unpairs, and that is handled once, in the paired
 * axios instance. Everything here treats "can't reach the API" (no response,
 * 5xx) as temporary: queries keep polling while they fail, so the screen's
 * "Can't reach Dyna Cam — retrying" banner clears by itself when the Wi-Fi
 * comes back.
 *
 * ── Demo mode ───────────────────────────────────────────────────────────────
 * Every hook resolves from `constants/demo.js` with no network: any 6-digit
 * key pairs (000000 is "wrong"), 60-second clips go Pending → Ready after a
 * few seconds, a game started with Start recording runs until End and is
 * then Processing → Ready after ~8 s (Court 2 starts out recording), and
 * payments succeed and save nothing.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Platform } from "react-native";
import Toast from "react-native-toast-message";
import { IS_DEMO } from "../../constants";
import {
  DEMO_CLIPS,
  DEMO_WRONG_PAIRING_KEY,
  demoAppClip,
  demoAppSession,
  demoCourtClips,
  demoCourtSessions,
  demoDelay,
  demoEnvelope,
  demoError,
  demoPairedCourts,
  demoEndRecording,
  demoRecordClip,
  demoStartRecording,
  makeDemoPairing,
  toDemoAppClip,
} from "../../constants/demo";
import { VERSION } from "../../constants/version";
import { usePairedStore } from "../../store/usePairedStore";
import { isConnectionError } from "../../utils/dynaCam";
import {
  createPairedPaymentApi,
  endRecordingApi,
  getCourtRecentClipsApi,
  getCourtSessionsApi,
  getPairedClipApi,
  getPairedCourtsApi,
  getPairedMeApi,
  getPairedSessionApi,
  lookupPairedPaymentApi,
  pairAppApi,
  recordClipApi,
  startRecordingApi,
  unpairPairedAppApi,
} from "../api/pairedApp";

const KEY = "paired";

/** How often a failing paired query retries ("Can't reach Dyna Cam — retrying"). */
const OFFLINE_RETRY_MS = 5000;
/** How often the QR screen asks whether a saving clip is ready. */
const CLIP_POLL_MS = 3000;
/** How often the court list refreshes camera status on its own. */
const COURTS_REFRESH_MS = 30000;
/** How often a game's QR screen asks how its parts are doing. */
const SESSION_POLL_MS = 5000;

/** Poll while the last attempt couldn't reach the API; stop on a real answer. */
const retryWhileOffline = (query) =>
  query.state.status === "error" && isConnectionError(query.state.error)
    ? OFFLINE_RETRY_MS
    : false;

const apiMessage = (error) =>
  error?.response?.data?.message || "Something went wrong";

// ─────────────────────────────────────────────────────────────────────────────
// usePairPhone — redeem a 6-digit key
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What to tell the person holding the phone, per answer. The Pair screen
 * shows this inline under the key (no toast — it's the screen's only job).
 */
export const pairErrorMessage = (error) => {
  const status = error?.response?.status;
  if (!status) {
    return "Can't reach Dyna Cam. Check the phone's Wi-Fi and try again.";
  }
  if (status === 429) {
    return apiMessage(error); // "Too many pairing attempts — wait a minute…"
  }
  if (status >= 500) {
    return "Dyna Cam is having trouble right now. Try again in a minute.";
  }
  // 400: wrong / expired / already used, or not 6 digits
  return (
    error?.response?.data?.message ||
    "That pairing key is wrong or has expired. Ask for a new one in the Admin portal."
  );
};

export const usePairPhone = () => {
  const pair = usePairedStore((s) => s.pair);

  return useMutation({
    mutationFn: async (code) => {
      if (IS_DEMO) {
        await demoDelay();
        if (code === DEMO_WRONG_PAIRING_KEY) {
          throw demoError(
            400,
            "That pairing key is wrong or has expired. Ask for a new one in the Admin portal.",
            "INVALID_INPUT",
          );
        }
        return demoEnvelope("This phone is paired", makeDemoPairing());
      }
      return pairAppApi({
        code,
        platform: Platform.OS,
        appVersion: VERSION,
      });
    },
    // Never retried: a wrong key must count once, not three times
    retry: false,
    onSuccess: (response) => {
      const { token, pairedApp, venue } = response.data;
      pair({ token, pairedApp, venue });
      Toast.show({
        type: "success",
        text1: `Paired to ${venue?.name ?? "the venue"}`,
        ...(IS_DEMO && { text2: "Demo mode — no server was contacted" }),
      });
    },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// useGetPairedMe — the phone's name and venue (renamed on the web? refresh)
// ─────────────────────────────────────────────────────────────────────────────
export const useGetPairedMe = () => {
  const token = usePairedStore((s) => s.token);
  return useQuery({
    queryKey: [KEY, "me"],
    queryFn: async () => {
      if (IS_DEMO) {
        await demoDelay();
        const { pairedApp, venue } = makeDemoPairing();
        return demoEnvelope("Paired phone", {
          pairedApp,
          venue: { ...venue, logoUrl: null, clipPrice: 50 },
          clipSeconds: 60,
        });
      }
      return getPairedMeApi();
    },
    enabled: Boolean(token),
    staleTime: 5 * 60 * 1000,
    refetchInterval: retryWhileOffline,
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// useGetPairedCourts
// ─────────────────────────────────────────────────────────────────────────────
export const useGetPairedCourts = () => {
  const token = usePairedStore((s) => s.token);
  return useQuery({
    queryKey: [KEY, "courts"],
    queryFn: async () => {
      if (IS_DEMO) {
        await demoDelay();
        return demoEnvelope("Courts", { courts: demoPairedCourts() });
      }
      return getPairedCourtsApi();
    },
    // A game this phone just ended can still show as recording for a moment
    select: hideEndedRecordings,
    enabled: Boolean(token),
    // Camera status changes on its own; keep it fresh while the list is up,
    // and retry quickly while the API can't be reached.
    refetchInterval: (query) => retryWhileOffline(query) || COURTS_REFRESH_MS,
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// useGetCourtRecentClips
// ─────────────────────────────────────────────────────────────────────────────
export const useGetCourtRecentClips = (courtId, limit = 10) => {
  const token = usePairedStore((s) => s.token);
  return useQuery({
    queryKey: [KEY, "courts", courtId, "clips", limit],
    queryFn: async () => {
      if (IS_DEMO) {
        await demoDelay();
        return demoEnvelope("Recent clips", {
          clips: demoCourtClips(courtId).slice(0, limit),
        });
      }
      return getCourtRecentClipsApi(courtId, limit);
    },
    enabled: Boolean(token && courtId),
    // While a clip in the list is still saving, refresh so it turns Ready
    refetchInterval: (query) =>
      retryWhileOffline(query) ||
      ((query.state.data?.data?.clips ?? []).some((c) => c.status === "Pending")
        ? OFFLINE_RETRY_MS
        : false),
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// useGetPairedClip — polled every 3 s while Pending
// ─────────────────────────────────────────────────────────────────────────────
export const useGetPairedClip = (clipId) => {
  const token = usePairedStore((s) => s.token);
  return useQuery({
    queryKey: [KEY, "clips", clipId],
    queryFn: async () => {
      if (IS_DEMO) {
        await new Promise((r) => setTimeout(r, 300));
        const clip = demoAppClip(clipId);
        if (!clip) throw demoError(404, "Clip not found");
        return demoEnvelope("Clip", { clip });
      }
      return getPairedClipApi(clipId);
    },
    enabled: Boolean(token && clipId),
    staleTime: 0,
    refetchInterval: (query) =>
      query.state.data?.data?.clip?.status === "Pending"
        ? CLIP_POLL_MS
        : retryWhileOffline(query),
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// useRecordClip — "Record": save the court's last 60 seconds
// ─────────────────────────────────────────────────────────────────────────────
/**
 * The caller opens the QR screen with `data.data` = { clipId, shareUrl,
 * merged }. Errors are toasted here in the words staff need at the court.
 */
export const useRecordClip = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (court) => {
      if (IS_DEMO) {
        await demoDelay();
        if (!court.canRecord) {
          throw demoError(
            503,
            "This court's camera or recorder box is offline — tell the manager",
            "CAMERA_OFFLINE",
          );
        }
        const clip = demoRecordClip(court);
        return demoEnvelope("Saving the clip", {
          clipId: clip.clipId,
          shareUrl: clip.shareUrl,
          merged: false,
        });
      }
      return recordClipApi(court.courtId);
    },
    // Never retried automatically: staff press Record again if they want to
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [KEY, "courts"] });
    },
    onError: (error) => {
      const status = error?.response?.status;
      if (status === 401) return; // unpaired — Navigation already moved on
      if (error?.response?.data?.code === "CAMERA_OFFLINE") {
        // The court list is out of date — refresh it so the button turns off
        queryClient.invalidateQueries({ queryKey: [KEY, "courts"] });
        Toast.show({
          type: "error",
          text1: "Camera offline — tell the manager",
          text2: "Nothing was saved.",
        });
        return;
      }
      Toast.show({
        type: "error",
        text1: isConnectionError(error)
          ? "Can't reach Dyna Cam"
          : "Couldn't save the clip",
        text2: isConnectionError(error)
          ? "Check the Wi-Fi and press Record again."
          : apiMessage(error),
      });
    },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Take payment — this venue's clips only
// ─────────────────────────────────────────────────────────────────────────────
export const useLookupPairedPayCode = (payCode) => {
  const token = usePairedStore((s) => s.token);
  return useQuery({
    queryKey: [KEY, "payments", "lookup", payCode],
    queryFn: async () => {
      if (IS_DEMO) {
        await demoDelay();
        const clip = DEMO_CLIPS.find(
          (c) => c.payCode === payCode && c.venueId === makeDemoPairing().venue.venueId,
        );
        if (!clip) throw demoError(404, "No clip at this venue has that pay code");
        return demoEnvelope("Clip found", {
          clip: toDemoAppClip(clip, { alwaysPayCode: true }),
        });
      }
      return lookupPairedPaymentApi(payCode);
    },
    enabled: Boolean(token && payCode),
    staleTime: 0,
  });
};

export const useRecordPairedCashPayment = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload) => {
      if (IS_DEMO) {
        await demoDelay();
        const clip = DEMO_CLIPS.find((c) => c.payCode === payload.payCode);
        return demoEnvelope("Payment recorded — the clip is unlocked", {
          paymentId: "demo-payment-new",
          clipId: clip?.clipId ?? null,
          amount: clip?.price ?? 0,
        });
      }
      return createPairedPaymentApi(payload);
    },
    retry: false,
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: [KEY] });
      Toast.show({
        type: "success",
        text1: "Payment recorded",
        text2: IS_DEMO
          ? "Demo mode — nothing was saved"
          : response?.message || "The clip is unlocked",
      });
    },
    onError: (error) => {
      if (error?.response?.status === 401) return;
      Toast.show({
        type: "error",
        text1: isConnectionError(error)
          ? "Can't reach Dyna Cam"
          : "Couldn't record the payment",
        text2: isConnectionError(error)
          ? "Nothing was recorded. Check the Wi-Fi and try again."
          : apiMessage(error),
      });
    },
  });
};

/**
 * "Unpair this phone": revoke it on the server so the token is dead
 * everywhere. Best effort — offline (or in demo mode) nothing is sent and the
 * web portal can still revoke it; the caller forgets the token either way.
 */
export const revokeThisPhone = async () => {
  if (IS_DEMO) return;
  try {
    await unpairPairedAppApi();
  } catch {
    // Never log it — an axios error carries the token in its request headers
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Whole-game recording (PLAN-002 Phase D) — Start / End on a court
// ─────────────────────────────────────────────────────────────────────────────

/** The game statuses that are still changing on their own. */
const LIVE_SESSION = ["Recording", "Processing"];

/**
 * Games this phone has ended. End keeps at least a second of footage, so for
 * a moment after End the API can still list the court as recording (a
 * refetch already in flight can also answer with the old state); either
 * would flip the button back to "End recording".
 * `useGetPairedCourts` hides a recording whose game is in here.
 */
const endedSessions = new Set();

/** Drops recordings this phone already ended (see `endedSessions`). */
const hideEndedRecordings = (response) => {
  const courts = response?.data?.courts;
  if (!courts || endedSessions.size === 0) return response;
  return {
    ...response,
    data: {
      ...response.data,
      courts: courts.map((c) =>
        c.recording && endedSessions.has(c.recording.sessionId)
          ? { ...c, recording: null }
          : c,
      ),
    },
  };
};

/** Put a court's running recording (or null) straight into the cached list. */
const patchCourtRecording = (queryClient, courtId, recording) =>
  queryClient.setQueryData([KEY, "courts"], (old) =>
    old?.data?.courts
      ? {
          ...old,
          data: {
            ...old.data,
            courts: old.data.courts.map((c) =>
              c.courtId === courtId ? { ...c, recording } : c,
            ),
          },
        }
      : old,
  );

/**
 * Start recording the whole game. The caller reads `data.data.recording`
 * and `data.message` ("Already recording" when another phone — or a double
 * tap — got there first: same game, nothing new started).
 *
 * Errors are NOT toasted: the Court screen shows them inline under the
 * button (503 camera offline, 409 a booking starts soon, connection).
 */
export const useStartRecording = () => {
  const queryClient = useQueryClient();
  const phoneName = usePairedStore((s) => s.pairedApp?.name);

  return useMutation({
    mutationFn: async (court) => {
      if (IS_DEMO) {
        await demoDelay();
        if (!court.canRecord) {
          throw demoError(
            503,
            "This court's camera or recorder box is offline — tell the manager",
            "CAMERA_OFFLINE",
          );
        }
        const { recording, already } = demoStartRecording(
          court,
          phoneName ?? "This phone",
        );
        return demoEnvelope(already ? "Already recording" : "Recording started", {
          recording: { ...recording, already },
        });
      }
      return startRecordingApi(court.courtId);
    },
    retry: false,
    onSuccess: (response, court) => {
      const { shareUrl, ...recording } = response.data?.recording ?? {};
      // Show the running timer at once; the refetch confirms it
      patchCourtRecording(queryClient, court.courtId, recording);
      queryClient.invalidateQueries({ queryKey: [KEY, "courts"] });
    },
  });
};

/**
 * End the court's game. `data.data.session` is the AppSession (Processing
 * while its parts upload) — the caller opens its QR. Errors are inline, as
 * for Start.
 */
export const useEndRecording = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (courtId) => {
      if (IS_DEMO) {
        await demoDelay();
        const session = demoEndRecording(courtId);
        if (!session) throw demoError(409, "This court isn't recording");
        return demoEnvelope("Recording ended — the game is being saved", {
          session,
        });
      }
      return endRecordingApi(courtId);
    },
    retry: false,
    onSuccess: (response, courtId) => {
      const session = response.data?.session;
      if (session?.sessionId) endedSessions.add(session.sessionId);
      patchCourtRecording(queryClient, courtId, null);
      if (session) {
        // Seed the game's QR screen with it (same envelope as GET /sessions/:id)
        queryClient.setQueryData([KEY, "sessions", session.sessionId], {
          success: true,
          message: response.message,
          data: { session },
        });
      }
      queryClient.invalidateQueries({ queryKey: [KEY, "courts"] });
    },
    onError: (error) => {
      // 409 "This court isn't recording" — it stopped by itself or on another
      // phone; refresh so the button turns back into Start
      if (error?.response?.status === 409) {
        queryClient.invalidateQueries({ queryKey: [KEY, "courts"] });
      }
    },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// useGetPairedSession — a game, polled every 5 s while Recording/Processing
// ─────────────────────────────────────────────────────────────────────────────
export const useGetPairedSession = (sessionId) => {
  const token = usePairedStore((s) => s.token);
  return useQuery({
    queryKey: [KEY, "sessions", sessionId],
    queryFn: async () => {
      if (IS_DEMO) {
        await new Promise((r) => setTimeout(r, 300));
        const session = demoAppSession(sessionId);
        if (!session) throw demoError(404, "Session not found");
        return demoEnvelope("Session", { session });
      }
      return getPairedSessionApi(sessionId);
    },
    enabled: Boolean(token && sessionId),
    staleTime: 0,
    refetchInterval: (query) =>
      LIVE_SESSION.includes(query.state.data?.data?.session?.status)
        ? SESSION_POLL_MS
        : retryWhileOffline(query),
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// useGetCourtSessions — a court's games, newest first
// ─────────────────────────────────────────────────────────────────────────────
export const useGetCourtSessions = (courtId, limit = 10) => {
  const token = usePairedStore((s) => s.token);
  return useQuery({
    queryKey: [KEY, "courts", courtId, "sessions", limit],
    queryFn: async () => {
      if (IS_DEMO) {
        await demoDelay();
        return demoEnvelope("Sessions", {
          sessions: demoCourtSessions(courtId).slice(0, limit),
        });
      }
      return getCourtSessionsApi(courtId, limit);
    },
    enabled: Boolean(token && courtId),
    // A game that's saving changes quickly; a running one only gains parts
    refetchInterval: (query) => {
      const sessions = query.state.data?.data?.sessions ?? [];
      if (sessions.some((x) => x.status === "Processing")) return SESSION_POLL_MS;
      if (sessions.some((x) => x.status === "Recording")) return COURTS_REFRESH_MS;
      return retryWhileOffline(query);
    },
  });
};
