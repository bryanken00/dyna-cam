import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * PLAN-009: the player app's sidebar, full or folded to an icon rail (tablets
 * and up). A per-browser convenience; if storage is blocked it just starts full.
 */
export const useLayoutStore = create(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    }),
    {
      name: `${import.meta.env.VITE_STORE_KEY}-player-layout`,
      storage: createJSONStorage(() => {
        try {
          return localStorage;
        } catch {
          return undefined;
        }
      }),
    },
  ),
);
