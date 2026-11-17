import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Auth store — persisted to AsyncStorage, so a session survives app restarts.
 *
 * `isAuthenticated` is what Navigation switches on. Nothing else should decide
 * whether the user is signed in. While `user.mustChangePassword` is true,
 * Navigation shows only the change-password screen — the API refuses
 * everything else with 403 `PASSWORD_CHANGE_REQUIRED` until it is changed.
 *
 * The tokens are read by the axios interceptors via `getState()` — see
 * services/api/axios.js. Do not pass them around manually. The API rotates the
 * refresh token on every refresh, so always store the new one.
 *
 * Note this persists the tokens to AsyncStorage, which is not encrypted. If you
 * are handling sensitive data, swap the storage for `expo-secure-store`.
 */
export const useUserAuthStore = create(
  persist(
    (set) => ({
      token: null,
      refreshToken: null,
      user: null,
      isAuthenticated: false,

      /**
       * Called by useLoginAuth on a successful login.
       * @param {object} user         - see `toStoreUser` in services/requests/auth.js
       * @param {string} token        - JWT access token
       * @param {string} refreshToken - refresh token (rotated on every refresh)
       */
      login: (user, token, refreshToken = null) =>
        set({
          user,
          token,
          refreshToken,
          isAuthenticated: true,
        }),

      /** Store a new token pair, e.g. after a refresh or a password change. */
      setSession: (token, refreshToken) =>
        set((s) => ({
          token,
          refreshToken: refreshToken ?? s.refreshToken,
        })),

      /** Update user info in place, e.g. after a profile edit */
      setUser: (user) => set({ user }),

      /** Flag (or clear) a pending forced password change. */
      setMustChangePassword: (mustChangePassword) =>
        set((s) =>
          s.user ? { user: { ...s.user, mustChangePassword } } : {},
        ),

      /** Clear all auth state — called on logout and when the session expires */
      logout: () =>
        set({
          token: null,
          refreshToken: null,
          user: null,
          isAuthenticated: false,
        }),
    }),
    {
      name: "user-auth",
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
