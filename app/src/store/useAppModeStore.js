import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { secureStorage } from "./secureStorage";

/**
 * PLAN-009: what this install is for, chosen on first launch and remembered.
 *
 *   null     → Welcome: "I'm a player" / "Set up a courtside device"
 *   "player" → the DGSports player app (sign in, book, open plays, …)
 *   "device" → the courtside session device (Pair → Session → Ended, PLAN-002)
 *
 * Kept in the secure store with the device's pairing, so a courtside tablet
 * never opens on the player app after an update.
 *
 * Installs from before PLAN-009 have a pairing but no mode: App.js treats a
 * paired device with no mode as "device" (see Navigation/index.js).
 */
export const APP_MODE = { player: "player", device: "device" };

export const useAppModeStore = create(
  persist(
    (set) => ({
      mode: null,
      hydrated: false,
      setMode: (mode) => set({ mode }),
      /** Back to the first-launch choice. */
      clearMode: () => set({ mode: null }),
    }),
    {
      name: "app-mode",
      storage: createJSONStorage(() => secureStorage),
      partialize: (s) => ({ mode: s.mode }),
      onRehydrateStorage: () => (state, error) => {
        if (error) console.error("[AppMode] Couldn't read the app mode:", error.message);
        useAppModeStore.setState({ hydrated: true });
      },
    },
  ),
);

export default useAppModeStore;
