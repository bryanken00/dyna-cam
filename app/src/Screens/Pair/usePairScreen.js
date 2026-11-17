import { useEffect, useRef, useState } from "react";
import { Keyboard } from "react-native";
import { pairErrorMessage, usePairPhone } from "@/services/requests/pairedApp";
import { usePairedStore } from "@/store/usePairedStore";

export const KEY_LENGTH = 6;

/** Whatever was typed or pasted ("123-456", " 123 456 ") → up to 6 digits. */
const toDigits = (value) => String(value ?? "").replace(/\D/g, "").slice(0, KEY_LENGTH);

/**
 * State for "Pair this phone": the 6-digit key, submitting it, and what to
 * say when it fails (wrong / expired, too many tries, can't reach the API).
 *
 * The key submits itself when the 6th digit lands — typing or pasting — once
 * per distinct key, so a wrong key isn't re-sent (and re-counted against the
 * rate limit) by an unrelated re-render. On success the pairing store gets
 * the token and Navigation swaps to paired mode; nothing else to do here.
 */
export const usePairScreen = () => {
  const [code, setCode] = useState("");
  const pairPhone = usePairPhone();
  const notice = usePairedStore((s) => s.notice);
  const clearNotice = usePairedStore((s) => s.clearNotice);
  const lastSent = useRef(null);

  const complete = code.length === KEY_LENGTH;

  const submit = () => {
    if (!complete || pairPhone.isPending) return;
    Keyboard.dismiss();
    lastSent.current = code;
    clearNotice();
    pairPhone.mutate(code);
  };

  useEffect(() => {
    if (complete && lastSent.current !== code) submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, complete]);

  return {
    code,
    setCode: (value) => {
      const next = toDigits(value);
      setCode(next);
      // Editing the key clears the last attempt's error
      if (next !== lastSent.current && pairPhone.isError) pairPhone.reset();
    },
    complete,
    submit,
    pairing: pairPhone.isPending,
    error: pairPhone.isError ? pairErrorMessage(pairPhone.error) : null,
    notice,
  };
};

export default usePairScreen;
