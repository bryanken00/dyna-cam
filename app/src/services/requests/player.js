/**
 * Request hooks — the signed-in player (PLAN-009 phase A)
 *
 * Store writes, toasts and invalidation live here. Navigation switches on
 * usePlayerStore by itself (signed out → Sign in; profile not complete →
 * Complete your profile; else the tabs) — nothing navigates by hand.
 *
 * Sign-in: the in-app browser opens the API's Google start with a challenge
 * (the SHA-256 of a secret made here); Google comes back to
 * dgsports://signed-in?code=…, and the code is traded for tokens WITH the
 * secret — a caught redirect is useless without it.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import Toast from "react-native-toast-message";
import { IS_DEMO } from "../../constants";
import { demoDelay, demoEnvelope } from "../../constants/demo";
import {
  DEMO_PLAYER_TOKENS,
  demoGetPlayer,
  demoMyGames,
  demoSaveProfile,
} from "../../constants/demoPlayer";
import { usePlayerStore } from "../../store/usePlayerStore";
import {
  APP_SIGNED_IN_URL,
  getMeApi,
  getMyGamesApi,
  googleStartUrl,
  redeemSignInApi,
  saveProfileApi,
  signOutApi,
} from "../api/player";

export const PLAYER_KEY = ["player"];
export const PLAYER_ME_KEY = ["player", "me"];
export const MY_GAMES_KEY = ["player", "games"];

const CONNECTION = "Can't reach DGSports. Check your connection and try again.";

/** What to say when an API call fails, for an inline message or a toast. */
export const playerErrorMessage = (error, fallback = "Something went wrong — try again.") => {
  const status = error?.response?.status;
  if (!status) return CONNECTION;
  if (status >= 500) return "DGSports is having trouble right now. Try again in a minute.";
  return error.response.data?.message || fallback;
};

/** The ?error= the sign-in can come back with → what to tell the player. */
const SIGN_IN_ERRORS = {
  off: "Google sign-in isn't set up on this server yet.",
  expired: "That took too long — try again.",
  refused: "This account can't sign in. Contact the venue or DGSports.",
};

const toBase64Url = (base64) => base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** The app's one-time secret (64 hex characters) and its challenge. */
const makeVerifier = async () => {
  const bytes = Crypto.getRandomBytes(32);
  const verifier = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  return { verifier, challenge: toBase64Url(digest) };
};

// ─────────────────────────────────────────────────────────────────────────────
// useGoogleSignIn — the in-app browser, then the code → tokens
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves to true when signed in, false when the player closed the browser.
 * Rejects with an Error whose message is for the screen.
 */
export const useGoogleSignIn = () => {
  const setTokens = usePlayerStore((s) => s.setTokens);
  const setPlayer = usePlayerStore((s) => s.setPlayer);

  return useMutation({
    mutationFn: async () => {
      if (IS_DEMO) {
        await demoDelay();
        setTokens(DEMO_PLAYER_TOKENS);
        setPlayer(demoGetPlayer().player);
        return true;
      }

      const { verifier, challenge } = await makeVerifier();
      const result = await WebBrowser.openAuthSessionAsync(
        googleStartUrl(challenge),
        APP_SIGNED_IN_URL,
      );
      if (result.type !== "success") return false; // closed or cancelled

      const { code, error } = Linking.parse(result.url).queryParams || {};
      if (error === "cancelled") return false;
      if (error || !code) {
        throw new Error(SIGN_IN_ERRORS[error] || "Google couldn't sign you in — try again.");
      }

      let session;
      try {
        session = await redeemSignInApi({ code: String(code), verifier });
      } catch (err) {
        throw new Error(playerErrorMessage(err, "That sign-in expired — try again."));
      }
      setTokens(session.data);
      try {
        const me = await getMeApi();
        setPlayer(me.data.player);
      } catch {
        // Signed in; usePlayerMe loads the profile when it can
      }
      return true;
    },
    retry: false,
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// usePlayerMe — the profile (kept in the store too, for offline launches)
// ─────────────────────────────────────────────────────────────────────────────
export const usePlayerMe = () => {
  const signedIn = usePlayerStore((s) => Boolean(s.accessToken));
  const setPlayer = usePlayerStore((s) => s.setPlayer);

  return useQuery({
    queryKey: PLAYER_ME_KEY,
    enabled: signedIn,
    queryFn: async () => {
      const response = IS_DEMO ? demoEnvelope("Player", demoGetPlayer()) : await getMeApi();
      setPlayer(response.data.player);
      return response;
    },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// useSaveProfile — PATCH /player/me (the first sign-in's profile, or an edit)
// ─────────────────────────────────────────────────────────────────────────────
export const useSaveProfile = () => {
  const queryClient = useQueryClient();
  const setPlayer = usePlayerStore((s) => s.setPlayer);

  return useMutation({
    mutationFn: async (payload) => {
      if (IS_DEMO) {
        await demoDelay();
        return demoEnvelope("Profile saved", demoSaveProfile(payload));
      }
      return saveProfileApi(payload);
    },
    onSuccess: (response) => {
      setPlayer(response.data.player);
      queryClient.setQueryData(PLAYER_ME_KEY, response);
      Toast.show({ type: "success", text1: "Profile saved" });
    },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// useSignOut — ends this sign-in on the API (best effort), then here
// ─────────────────────────────────────────────────────────────────────────────
export const useSignOut = () => {
  const queryClient = useQueryClient();
  const signOut = usePlayerStore((s) => s.signOut);

  return useMutation({
    mutationFn: async () => {
      const { refreshToken } = usePlayerStore.getState();
      if (IS_DEMO || !refreshToken) return null;
      try {
        await signOutApi(refreshToken);
      } catch {
        // Offline: the refresh token still runs out on its own; sign out here anyway
      }
      return null;
    },
    onSettled: () => {
      signOut();
      queryClient.removeQueries({ queryKey: PLAYER_KEY });
    },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// useMyGames — upcoming bookings, then past ones, with their games and videos
// ─────────────────────────────────────────────────────────────────────────────
export const useMyGames = ({ page = 1, limit = 20 } = {}) => {
  const signedIn = usePlayerStore((s) => Boolean(s.accessToken));

  return useQuery({
    queryKey: [...MY_GAMES_KEY, { page, limit }],
    enabled: signedIn,
    queryFn: async () => {
      if (IS_DEMO) {
        await demoDelay();
        return demoEnvelope("Game log", demoMyGames());
      }
      return getMyGamesApi({ page, limit });
    },
  });
};
