import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { queryClient } from "../config/queryClient";

/**
 * PLAN-008 phase B: the back office's super-admin session — kept apart from the
 * staff `useAdminAuthStore` (its own tokens, from /api/v1/backoffice/auth; a staff
 * token never works there and this one never works in Admin). Same shape as the
 * admin store so the shared axios refresh / session-expired handling works for it
 * (`userTypeAuth.backoffice`). `userData` is the admin: { platformAdminId, firstName,
 * lastName, email, mustChangePassword }.
 */
export const useBackofficeAuthStore = create(
  persist(
    (set) => ({
      userData: null,
      token: null,
      refreshToken: null,
      setToken: (token) => set({ token }),
      setRefreshToken: (refreshToken) => set({ refreshToken }),
      setUserData: (userData) => set({ userData }),
      setSession: ({ token, refreshToken, userData }) => set({ token, refreshToken, userData }),
      reset: () => set({ userData: null, token: null, refreshToken: null }),
    }),
    {
      name: `${import.meta.env.VITE_STORE_KEY}-backoffice`,
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

// Signed out (or the session ended): forget the back office's cached data
useBackofficeAuthStore.subscribe((state, prevState) => {
  if (prevState.token && !state.token) {
    queryClient.removeQueries({ queryKey: ["backoffice"] });
  }
});
