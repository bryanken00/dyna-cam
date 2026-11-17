import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { queryClient } from "../config/queryClient";

// Admin Auth Store
export const useAdminAuthStore = create(
  persist(
    (set) => ({
      userData: null,
      token: null,
      refreshToken: null,
      permissions: [],
      setToken: (token) => set({ token }),
      setRefreshToken: (refreshToken) => set({ refreshToken }),
      setUserData: (userData) => set({ userData }),
      setUser: (userData) => set({ userData }), // Alias for compatibility
      setPermissions: (permissions) => set({ permissions }),
      reset: () =>
        set({
          userData: null,
          token: null,
          refreshToken: null,
          permissions: [],
        }),
    }),
    {
      name: `${import.meta.env.VITE_STORE_KEY}-admin-auth`,
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

// Drop every cached query and mutation when the session ends — a manual logout
// or an expired/revoked token (axios `handleSessionExpired` → reset()) — so the
// next account to sign in on this tab never sees the previous one's data.
// Keyed on the token going from set → empty, so a token refresh (set → set) and
// a login (empty → set) leave the cache alone.
const clearQueryCacheOnLogout = (state, prevState) => {
  if (prevState.token && !state.token) queryClient.clear();
};

useAdminAuthStore.subscribe(clearQueryCacheOnLogout);
