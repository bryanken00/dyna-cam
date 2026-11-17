import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Paired-phone store (PLAN-002) — the venue's shared staff phone.
 *
 * A phone is paired once with a 6-digit key from the web portal and then
 * calls `/api/v1/app/*` with `Authorization: App <token>`. That token is the
 * phone's only credential, so it is persisted to **expo-secure-store**
 * (Keychain / Android Keystore), not AsyncStorage: a shared front-desk phone
 * is exactly the device someone else picks up. This sits beside
 * `useUserAuthStore` (a person's staff-account session), never inside it.
 *
 * Navigation switches on `token`: a token means paired mode.
 *
 * The token is cleared in exactly two cases:
 *  • the API answers a paired call with 401 `TOKEN_INVALID` (the phone was
 *    revoked on the web) — see the paired instance in services/api/axios.js;
 *  • someone taps "Unpair this phone" (local only; the web still lists the
 *    phone until it is revoked there).
 * A network error or a 5xx never unpairs.
 *
 * `hydrated` turns true once the secure store has been read, so the app can
 * hold the splash screen instead of flashing the Pair screen at a phone that
 * is already paired.
 */

/**
 * SecureStore as a zustand storage. It does not exist on web, where the
 * pairing simply isn't remembered (paired mode is a phone feature).
 */
const secureStorage =
  Platform.OS === "web"
    ? {
        getItem: async () => null,
        setItem: async () => {},
        removeItem: async () => {},
      }
    : {
        getItem: (name) => SecureStore.getItemAsync(name),
        setItem: (name, value) => SecureStore.setItemAsync(name, value),
        removeItem: (name) => SecureStore.deleteItemAsync(name),
      };

export const usePairedStore = create(
  persist(
    (set) => ({
      token: null,
      /** { pairedAppId, name } — the phone's name, set on the web */
      pairedApp: null,
      /** { venueId, name } */
      venue: null,
      /** Shown once on the Pair screen, e.g. after the web revoked the phone */
      notice: null,
      hydrated: false,

      /** Called by usePairPhone with the POST /pair/app response. */
      pair: ({ token, pairedApp, venue }) =>
        set({ token, pairedApp, venue, notice: null }),

      /** Keep the name/venue fresh from GET /app/me (renamed on the web). */
      setDetails: ({ pairedApp, venue }) =>
        set((s) => ({
          pairedApp: pairedApp ?? s.pairedApp,
          venue: venue ? { venueId: venue.venueId, name: venue.name } : s.venue,
        })),

      /** Forget the pairing. `notice` explains why on the Pair screen. */
      unpair: (notice = null) =>
        set({ token: null, pairedApp: null, venue: null, notice }),

      clearNotice: () => set({ notice: null }),
    }),
    {
      // SecureStore keys allow letters, digits, ".", "-" and "_" only
      name: "paired-app",
      storage: createJSONStorage(() => secureStorage),
      // Only the pairing itself is secret-worthy and worth keeping
      partialize: (s) => ({
        token: s.token,
        pairedApp: s.pairedApp,
        venue: s.venue,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (error) console.error("[Paired] Couldn't read the pairing:", error.message);
        usePairedStore.setState({ hydrated: true });
      },
    },
  ),
);

export default usePairedStore;
