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
 * key pairs (000000 is "wrong"), recordings go Pending → Ready after a few
 * seconds, payments succeed and save nothing.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Platform } from "react-native";
import Toast from "react-native-toast-message";
import { IS_DEMO } from "../../constants";
import {
  DEMO_CLIPS,
  DEMO_WRONG_PAIRING_KEY,
  demoAppClip,
  demoCourtClips,
  demoDelay,
  demoEnvelope,
  demoError,
  demoPairedCourts,
  demoRecordClip,
  makeDemoPairing,
  toDemoAppClip,
} from "../../constants/demo";
import { VERSION } from "../../constants/version";
import { usePairedStore } from "../../store/usePairedStore";
import { isConnectionError } from "../../utils/dynaCam";
import {
  createPairedPaymentApi,
  getCourtRecentClipsApi,
  getPairedClipApi,
  getPairedCourtsApi,
  getPairedMeApi,
  lookupPairedPaymentApi,
  pairAppApi,
  recordClipApi,
  unpairPairedAppApi,
} from "../api/pairedApp";

const KEY = "paired";

/** How often a failing paired query retries ("Can't reach Dyna Cam — retrying"). */
const OFFLINE_RETRY_MS = 5000;
/** How often the QR screen asks whether a saving clip is ready. */
const CLIP_POLL_MS = 3000;
/** How often the court list refreshes camera status on its own. */
const COURTS_REFRESH_MS = 30000;

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
