import { QueryClient } from "@tanstack/react-query";

// The app's single QueryClient. It lives in its own module (not inside App.jsx)
// so non-React code — the auth stores — can reach it to drop the cache when a
// session ends. Inside components and hooks, use `useQueryClient()` instead.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5 * 60 * 1000, // 5 minutes
    },
  },
});
