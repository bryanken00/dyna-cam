/**
 * Request hooks — Payments, cash at the front desk (permission payments)
 *
 * Side effects live here: toasts and cache invalidation. Screens and module
 * hooks import from this file, never from api/.
 *
 * Demo mode: the lookup searches the clip fixtures by pay code; recording a
 * payment succeeds and saves nothing.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Toast from "react-native-toast-message";
import { IS_DEMO } from "../../constants";
import {
  DEMO_CLIPS,
  demoDelay,
  demoEnvelope,
  demoError,
} from "../../constants/demo";
import { createPaymentApi, lookupPaymentApi } from "../api/payments";

const KEY = "payments";

// ─────────────────────────────────────────────────────────────────────────────
// useLookupPayCode
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @param {string|null} payCode - normalised ("K7QM2P"); null = don't look up
 *
 * A wrong code is a 404 that will never succeed by being repeated, so this
 * never retries it (the app-wide default already skips 4xx).
 */
export const useLookupPayCode = (payCode) => {
  return useQuery({
    queryKey: [KEY, "lookup", payCode],
    queryFn: async () => {
      if (IS_DEMO) {
        await demoDelay();
        const clip = DEMO_CLIPS.find((c) => c.payCode === payCode);
        if (!clip) throw demoError(404, "No clip has that pay code");
        const { clipId, venueId, venueName, courtName, source, requestedAt,
                price, paymentStatus, status, thumbnailUrl } = clip;
        return demoEnvelope("Clip found", {
          clip: { clipId, venueId, venueName, courtName, source, requestedAt,
                  price, paymentStatus, payCode, status, thumbnailUrl },
        });
      }
      return lookupPaymentApi(payCode);
    },
    enabled: Boolean(payCode),
    // The clip's payment state is what staff act on — never show a stale one
    staleTime: 0,
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// useRecordCashPayment
// ─────────────────────────────────────────────────────────────────────────────
/** payload: { payCode } — the clip unlocks for the player. */
export const useRecordCashPayment = () => {
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
      return createPaymentApi(payload);
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: [KEY] });
      // The clip's paymentStatus changed
      queryClient.invalidateQueries({ queryKey: ["clips"] });
      Toast.show({
        type: "success",
        text1: "Payment recorded",
        text2: IS_DEMO
          ? "Demo mode — nothing was saved"
          : response?.message || "The clip is unlocked",
      });
    },
    onError: (error) => {
      Toast.show({
        type: "error",
        text1: "Couldn't record the payment",
        text2: error.response?.data?.message || "Something went wrong",
      });
    },
  });
};
