import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export const useCsrfStore = create(
  persist(
    (set) => ({
      csrfToken: null,
      setCsrfToken: (csrfToken) => set({ csrfToken }),
      clearCsrfToken: () => set({ csrfToken: null }),
    }),
    {
      name: `${import.meta.env.VITE_STORE_KEY}-csrf-token`,
      storage: createJSONStorage(() => sessionStorage), // Use sessionStorage for CSRF tokens
    },
  ),
);
