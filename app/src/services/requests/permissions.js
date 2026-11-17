/**
 * Request hooks — the signed-in user's permissions
 *
 * Server data, so it lives in React Query (not the auth store), exactly like
 * the web portal's `usePermissions`. Read it through `hooks/usePermissions.js`,
 * which adds the `can()` check.
 *
 * Keyed by accountId, so a different user signing in on the same phone never
 * sees the previous user's menu, even for a moment.
 */
import { useQuery } from "@tanstack/react-query";
import { IS_DEMO } from "../../constants";
import { DEMO_PERMISSIONS, demoDelay, demoEnvelope } from "../../constants/demo";
import { useUserAuthStore } from "../../store/useUserAuthStore";
import { getMyPermissionsApi } from "../api/permissions";

// ─────────────────────────────────────────────────────────────────────────────
// useGetMyPermissions
// ─────────────────────────────────────────────────────────────────────────────
export const useGetMyPermissions = () => {
  const accountId = useUserAuthStore((s) => s.user?.accountId ?? null);
  const isAuthenticated = useUserAuthStore((s) => s.isAuthenticated);

  return useQuery({
    queryKey: ["auth", "permissions", accountId],
    queryFn: async () => {
      if (IS_DEMO) {
        await demoDelay();
        return demoEnvelope("User permissions retrieved", {
          permissions: DEMO_PERMISSIONS,
        });
      }
      return getMyPermissionsApi();
    },
    enabled: isAuthenticated && Boolean(accountId),
    // Same as the web: a role change reaches the app within 10 minutes, or at
    // once on pull-to-refresh of the Menu.
    staleTime: 10 * 60 * 1000,
  });
};
