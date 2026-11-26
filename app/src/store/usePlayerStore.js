import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { secureStorage } from "./secureStorage";

/**
 * PLAN-009: the signed-in player (PLAN-006's player tokens, own audience).
 *
 * The access token lives 15 minutes, the refresh token 30 days and rotates on
 * every refresh (services/api/axios.js does that). Both are secrets: kept in
 * expo-secure-store, never AsyncStorage, never logged.
 *
 * `player` is GET /player/me's `player` — kept so the app opens on the right
 * screen offline; React Query refreshes it.
 *
 * Signed out when: the player taps Sign out, or a refresh is refused
 * (401 TOKEN_INVALID — the refresh token was revoked, used twice or expired).
 * A network error or a 5xx never signs out.
 */
const EMPTY = { accessToken: null, refreshToken: null, player: null };

export const usePlayerStore = create(
  persist(
    (set) => ({
      ...EMPTY,
      hydrated: false,
      /** Shown once on Sign in — why the player is back there */
      notice: null,

      /** POST /player/session or /session/refresh's `data`. */
      setTokens: ({ accessToken, refreshToken }) =>
        set({ accessToken: accessToken.token, refreshToken: refreshToken.token, notice: null }),

      setPlayer: (player) => set({ player }),

      signOut: (notice = null) => set({ ...EMPTY, notice }),

      clearNotice: () => set({ notice: null }),
    }),
    {
      name: "player-session",
      storage: createJSONStorage(() => secureStorage),
      partialize: (s) => ({
        accessToken: s.accessToken,
        refreshToken: s.refreshToken,
        player: s.player,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (error) console.error("[Player] Couldn't read the sign-in:", error.message);
        usePlayerStore.setState({ hydrated: true });
      },
    },
  ),
);

export default usePlayerStore;
