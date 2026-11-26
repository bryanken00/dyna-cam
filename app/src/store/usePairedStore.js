import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { secureStorage } from "./secureStorage";

/**
 * Pairing store — the app's only credential (PLAN-002 Phase E).
 *
 * Staff book a session on the web and pair a device to THAT session with a
 * 6-digit key. The device gets a token, calls `/api/v1/app/*` with
 * `Authorization: App <token>`, and is unpaired again when the session is
 * over. The token is persisted to **expo-secure-store** (Keychain / Android
 * Keystore), never AsyncStorage: these are shared devices at the court.
 *
 * Navigation switches on `token`: no token → "Pair this device".
 *
 * The token is cleared when:
 *  • the API answers 401 `TOKEN_INVALID` (grace over, session cancelled, or
 *    unpaired on the web) — see services/api/axios.js;
 *  • staff tap Done on the Ended screen, or its 10-minute countdown runs out.
 * A network error or a 5xx never unpairs.
 *
 * `sessionEnded` is set once the API reports the session over, so a later
 * 401 can say "The session has ended" rather than "This device was unpaired".
 * `hydrated` turns true once the secure store has been read (App.js holds the
 * splash until then).
 */

const EMPTY = { token: null, device: null, sessionId: null, sessionEnded: false };

export const usePairedStore = create(
  persist(
    (set) => ({
      ...EMPTY,
      /** Shown once on the Pair screen — why the device is back there */
      notice: null,
      hydrated: false,

      /** Called by usePairDevice with POST /pair/app's `data`. */
      pair: ({ token, device, session }) =>
        set({
          token,
          device: device ?? null,
          sessionId: session?.sessionId ?? null,
          sessionEnded: false,
          notice: null,
        }),

      /** The API says the session is over (its grace has started). */
      markSessionEnded: () => set({ sessionEnded: true }),

      /** Forget the pairing. `notice` explains why on the Pair screen. */
      unpair: (notice = null) => set({ ...EMPTY, notice }),

      clearNotice: () => set({ notice: null }),
    }),
    {
      // SecureStore keys allow letters, digits, ".", "-" and "_" only
      name: "paired-app",
      storage: createJSONStorage(() => secureStorage),
      partialize: (s) => ({
        token: s.token,
        device: s.device,
        sessionId: s.sessionId,
        sessionEnded: s.sessionEnded,
      }),
      // v0 was a venue-wide phone pairing (Phase C/D). Those tokens were
      // revoked by migration 010 — drop them so the device opens straight on
      // "Pair this device" instead of waiting for a 401.
      version: 1,
      migrate: (persisted, version) => (version < 1 ? EMPTY : persisted),
      onRehydrateStorage: () => (state, error) => {
        if (error) console.error("[Paired] Couldn't read the pairing:", error.message);
        usePairedStore.setState({ hydrated: true });
      },
    },
  ),
);

export default usePairedStore;
