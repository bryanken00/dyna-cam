import { useRoute } from "@react-navigation/native";
import { useState } from "react";
import { Keyboard } from "react-native";
import usePermissions from "@/hooks/usePermissions";
import {
  useLookupPayCode,
  useRecordCashPayment,
} from "@/services/requests/payments";
import {
  PAYABLE_CLIP_STATUSES,
  PAY_CODE_PATTERN,
  formatPayCode,
  normalizePayCode,
} from "@/utils/dynaCam";

/**
 * Take payment: pay code → look up the clip → check it with the player →
 * record the cash → done.
 *
 * `code` is what's in the box (shown grouped, "K7Q M2P"); `submitted` is the
 * normalised code being looked up, set only when Find is tapped, so the query
 * doesn't fire on every keystroke. Opened from a clip (`{ payCode }`), it
 * looks the code up straight away.
 */
export const useTakePayment = () => {
  const routeCode = normalizePayCode(useRoute().params?.payCode);
  const startCode = PAY_CODE_PATTERN.test(routeCode) ? routeCode : null;

  const { can } = usePermissions();
  const [code, setCode] = useState(startCode ? formatPayCode(startCode) : "");
  const [submitted, setSubmitted] = useState(startCode);
  const [touched, setTouched] = useState(false);
  // { amount, courtName } after a payment is recorded; null = not yet
  const [done, setDone] = useState(null);

  const lookup = useLookupPayCode(submitted);
  const record = useRecordCashPayment();

  const normalized = normalizePayCode(code);
  const codeError = !normalized
    ? "Enter the pay code shown on the player's clip."
    : !PAY_CODE_PATTERN.test(normalized)
      ? "A pay code is 4–12 letters and numbers."
      : null;

  const clip = lookup.data?.data?.clip ?? null;
  const payable =
    Boolean(clip) &&
    clip.paymentStatus === "Unpaid" &&
    PAYABLE_CLIP_STATUSES.includes(clip.status);

  const find = () => {
    Keyboard.dismiss();
    setTouched(true);
    if (codeError) return;
    if (normalized === submitted) lookup.refetch();
    else setSubmitted(normalized);
  };

  const reset = () => {
    setCode("");
    setSubmitted(null);
    setTouched(false);
    setDone(null);
  };

  return {
    code,
    setCode: (v) => setCode(v.toUpperCase()),
    codeError: touched ? codeError : null,
    find,
    // lookup
    submitted,
    clip,
    looking: lookup.isFetching,
    lookupError:
      lookup.isError
        ? lookup.error?.response?.data?.message ||
          "Couldn't look the code up. Check your connection and try again."
        : null,
    payable,
    // record
    canRecord: can("payments", null, "write"),
    recording: record.isPending,
    recordPayment: () =>
      record.mutate(
        { payCode: clip.payCode },
        {
          onSuccess: (response) =>
            setDone({
              amount: response.data?.amount ?? clip.price,
              courtName: clip.courtName,
            }),
        },
      ),
    done,
    reset,
  };
};

export default useTakePayment;
