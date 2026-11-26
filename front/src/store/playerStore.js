import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { queryClient } from "../config/queryClient";

/**
 * PLAN-006: the player signed in with Google on the player pages — kept apart
 * from the staff `useAdminAuthStore`. Only the refresh token is stored (30 days,
 * rotated on use); the 15-minute access token lives in memory and is fetched
 * again with it after a reload. The player's name and email are server data
 * (React Query, `["player", "me"]`), not kept here.
 */
export const usePlayerStore = create(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      setSession: ({ accessToken, refreshToken }) => set({ accessToken, refreshToken }),
      setAccessToken: (accessToken) => set({ accessToken }),
      clear: () => set({ accessToken: null, refreshToken: null }),
    }),
    {
      name: `${import.meta.env.VITE_STORE_KEY}-player`,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ refreshToken: state.refreshToken }),
    },
  ),
);

// Signed out (or the session ended): forget the player's cached data
usePlayerStore.subscribe((state, prevState) => {
  if (prevState.refreshToken && !state.refreshToken) {
    queryClient.removeQueries({ queryKey: ["player"] });
  }
});

/** True while a player is signed in on this browser. */
export const usePlayerSignedIn = () => usePlayerStore((s) => !!s.refreshToken);
