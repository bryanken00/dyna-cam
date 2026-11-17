import { create } from "zustand";
import { persist } from "zustand/middleware";

const MODES = ["auto", "light", "dark"];

/** The OS colour-scheme query (null outside the browser). */
const systemDark =
  typeof window !== "undefined"
    ? (window.matchMedia?.("(prefers-color-scheme: dark)") ?? null)
    : null;

/** The scheme a mode puts on screen — "auto" follows the OS. */
const resolve = (mode) =>
  mode === "auto" ? (systemDark?.matches ? "dark" : "light") : mode;

/** Reflect the resolved scheme onto <html> so CSS `.dark` overrides apply. */
const applyClass = (resolved) => {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", resolved === "dark");
};

export const useThemeStore = create(
  persist(
    (set) => ({
      // The user's choice: "auto" (default — follow the OS), "light" or "dark".
      mode: "auto",
      // What is on screen right now — always "light" or "dark".
      resolved: resolve("auto"),

      setMode: (mode) => {
        const resolved = resolve(mode);
        applyClass(resolved);
        set({ mode, resolved });
      },
    }),
    {
      // Read by the pre-paint script in index.html — keep the two in step.
      name: `${import.meta.env.VITE_STORE_KEY}-ui-theme`,
      version: 1,
      // Only the choice is saved; `resolved` is worked out again on load.
      partialize: (state) => ({ mode: state.mode }),
      // v0 had no "auto" — it saved a light/dark pick — so start everyone on auto.
      migrate: () => ({ mode: "auto" }),
      merge: (persisted, current) => {
        const mode = MODES.includes(persisted?.mode)
          ? persisted.mode
          : current.mode;
        return { ...current, mode, resolved: resolve(mode) };
      },
      // Re-sync the <html> class once the persisted value is rehydrated.
      onRehydrateStorage: () => (state) => {
        if (state) applyClass(state.resolved);
      },
    },
  ),
);

// While on "auto", follow the OS when it switches between light and dark.
systemDark?.addEventListener("change", () => {
  if (useThemeStore.getState().mode !== "auto") return;
  const resolved = resolve("auto");
  applyClass(resolved);
  useThemeStore.setState({ resolved });
});
