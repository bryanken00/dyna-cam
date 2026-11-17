/**
 * Request hooks — Pairing this device to a session (PLAN-002 Phase E)
 *
 * The pairing store write lives here. On success Navigation swaps to the
 * Session screen by itself (it switches on the store's token).
 *
 * Demo mode: any 6-digit key pairs to the demo session; 000000 answers like
 * a wrong key, so the error state can be seen.
 */
import { useMutation } from "@tanstack/react-query";
import { Platform } from "react-native";
import { IS_DEMO } from "../../constants";
import {
  DEMO_WRONG_PAIRING_KEY,
  demoDelay,
  demoEnvelope,
  demoError,
  makeDemoPairing,
} from "../../constants/demo";
import { VERSION } from "../../constants/version";
import { usePairedStore } from "../../store/usePairedStore";
import { pairDeviceApi } from "../api/pairing";

const WRONG_KEY =
  "That pairing key is wrong or has expired. Ask staff for a new one.";

/**
 * What to tell the person holding the device, per answer. The Pair screen
 * shows it inline under the key — it's the screen's only job, so no toast.
 */
export const pairErrorMessage = (error) => {
  const status = error?.response?.status;
  if (!status) {
    return "Can't reach Dyna Cam. Check the device's Wi-Fi and try again.";
  }
  if (status === 429) {
    // "Too many pairing attempts — wait a minute…" / "Pairing is paused…"
    return error.response.data?.message || "Too many tries — wait a minute.";
  }
  if (status >= 500) {
    return "Dyna Cam is having trouble right now. Try again in a minute.";
  }
  // 400: wrong, expired or used — or the session already ended
  return error.response.data?.message || WRONG_KEY;
};

// ─────────────────────────────────────────────────────────────────────────────
// usePairDevice — redeem a 6-digit key
// ─────────────────────────────────────────────────────────────────────────────
export const usePairDevice = () => {
  const pair = usePairedStore((s) => s.pair);

  return useMutation({
    mutationFn: async (code) => {
      if (IS_DEMO) {
        await demoDelay();
        if (code === DEMO_WRONG_PAIRING_KEY) {
          throw demoError(400, WRONG_KEY, "INVALID_INPUT");
        }
        return demoEnvelope("This device is paired", makeDemoPairing());
      }
      return pairDeviceApi({ code, platform: Platform.OS, appVersion: VERSION });
    },
    // Never retried: a wrong key must count once against the rate limit
    retry: false,
    onSuccess: (response) => {
      const { token, device, session } = response.data;
      pair({ token, device, session });
    },
  });
};
