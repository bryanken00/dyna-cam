import { useState } from "react";
import { useGoogleSignIn } from "@/services/requests/player";
import { useAppModeStore } from "@/store/useAppModeStore";
import { usePlayerStore } from "@/store/usePlayerStore";

/**
 * Sign in's state: the Google sign-in, its inline error, and the notice that
 * says why the player is back here (signed out after a refused refresh).
 */
export const useSignInScreen = () => {
  const signIn = useGoogleSignIn();
  const notice = usePlayerStore((s) => s.notice);
  const clearNotice = usePlayerStore((s) => s.clearNotice);
  const clearMode = useAppModeStore((s) => s.clearMode);
  const [error, setError] = useState(null);

  const submit = () => {
    setError(null);
    clearNotice();
    signIn.mutate(undefined, { onError: (err) => setError(err.message) });
  };

  return {
    submit,
    signingIn: signIn.isPending,
    error,
    notice,
    /** Back to "I'm a player" / "Set up a courtside device" */
    changeMode: clearMode,
  };
};
