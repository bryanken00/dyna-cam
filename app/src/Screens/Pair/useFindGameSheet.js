import { useState } from "react";
import { Keyboard } from "react-native";
import { findGameErrorMessage, useFindGame } from "@/services/requests/pairing";
import { normalizePayCode, PAY_CODE_PATTERN } from "@/utils/dynaCam";

/**
 * CR-015 state for "Find a game" on the Pair screen: the code as typed, the
 * lookup, and its answer — the game (with its download link once paid) or
 * what went wrong. Finding again re-checks, so after staff take the payment
 * the same code shows the QR.
 */
export const useFindGameSheet = () => {
  const [open, setOpen] = useState(false);
  const [code, setCodeState] = useState("");
  const find = useFindGame();

  const normalized = normalizePayCode(code);
  const valid = PAY_CODE_PATTERN.test(normalized);
  const game = find.data?.data?.game ?? null;

  const setCode = (value) => {
    // Up to 12 letters and digits; a new code clears the last answer
    setCodeState(String(value ?? "").replace(/[^A-Za-z0-9 ]/g, "").slice(0, 14));
    if (find.data || find.error) find.reset();
  };

  return {
    open,
    show: () => setOpen(true),
    close: () => {
      setOpen(false);
      setCodeState("");
      find.reset();
    },
    code,
    setCode,
    valid,
    searching: find.isPending,
    game,
    error: find.error ? findGameErrorMessage(find.error) : null,
    submit: () => {
      if (!valid || find.isPending) return;
      Keyboard.dismiss();
      find.mutate(normalized);
    },
  };
};

export default useFindGameSheet;
