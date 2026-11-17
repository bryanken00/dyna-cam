/**
 * Request hooks — Auth
 *
 * The `requests/` layer is where side effects live: store writes, Toasts,
 * cache invalidation. The `api/` layer stays pure — it only makes the call and
 * returns `response.data`, which is the API's envelope
 * `{ success, message, data }`. The payload is always `.data` of that.
 *
 * Import API functions from services/api/ — never call an axios instance here.
 *
 * ── Demo mode ───────────────────────────────────────────────────────────────
 * When `IS_DEMO` is on, every hook below short-circuits before its API call
 * and resolves from `constants/demo.js` instead, so the app runs with no
 * backend at all. The bypass lives here rather than in `api/` on purpose:
 * `api/` describes the server, and a fake user is not something the server
 * does. Demo responses use the same envelope, so everything after the
 * mutation — store writes, toasts, navigation — is identical in both modes.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Toast from "react-native-toast-message";
import { IS_DEMO } from "../../constants";
import {
  demoDelay,
  demoEnvelope,
  makeDemoSession,
  makeDemoUser,
} from "../../constants/demo";
import { useUserAuthStore } from "../../store/useUserAuthStore";
import { clearCsrfToken } from "../api/axios";
import {
  changePasswordApi,
  getMeApi,
  loginApi,
  logoutApi,
} from "../api/auth";

/** The API's error message, if it sent one. */
const apiMessage = (error) =>
  error?.response?.data?.message || "Something went wrong";

/**
 * The user object the app keeps in its store, built from the API's `user`
 * (`accountId`, `firstName`, `lastName`, `email`, `roleId`, `roleName`,
 * `mustChangePassword`, …).
 */
export const toStoreUser = (user) => ({
  accountId: user.accountId,
  firstName: user.firstName,
  lastName: user.lastName,
  fullName: [user.firstName, user.lastName].filter(Boolean).join(" "),
  email: user.email,
  roleId: user.roleId,
  roleName: user.roleName,
  mustChangePassword: Boolean(user.mustChangePassword),
  // Permissions are not kept here: they are server data, loaded with React
  // Query by `useGetMyPermissions` (services/requests/permissions.js) and read
  // through `hooks/usePermissions.js` — the same split as the web portal.
});

// ─────────────────────────────────────────────────────────────────────────────
// useLoginAuth
// ─────────────────────────────────────────────────────────────────────────────
export const useLoginAuth = () => {
  // Call the Zustand hook directly inside the custom hook, not getState()
  const login = useUserAuthStore((s) => s.login);

  return useMutation({
    mutationFn: async (payload) => {
      if (IS_DEMO) {
        await demoDelay();
        return demoEnvelope("Login successful", {
          user: makeDemoUser(payload?.email),
          ...makeDemoSession(),
        });
      }
      return loginApi(payload);
    },
    onSuccess: (response) => {
      const { user, token, accessToken, refreshToken } = response.data;

      login(
        toStoreUser(user),
        token || accessToken?.token,
        refreshToken?.token ?? null,
      );

      Toast.show({
        type: "success",
        text1: "Login successful",
        ...(IS_DEMO && { text2: "Demo mode — no server was contacted" }),
      });
    },
    onError: (error) => {
      Toast.show({
        type: "error",
        text1: "Login failed",
        text2: apiMessage(error),
      });
    },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// useGetMe
// ─────────────────────────────────────────────────────────────────────────────
export const useGetMe = (options = {}) => {
  const user = useUserAuthStore((s) => s.user);

  return useQuery({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      if (IS_DEMO) {
        await demoDelay();
        return demoEnvelope("User profile", { user: user ?? makeDemoUser() });
      }
      return getMeApi();
    },
    ...options,
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// useChangePassword
// ─────────────────────────────────────────────────────────────────────────────
/**
 * payload: { currentPassword, newPassword }
 *
 * The API ends every session of the account and returns a new one for this
 * device, so the new tokens must be stored or the next request signs the user
 * out. It also clears a pending forced change.
 */
export const useChangePassword = () => {
  const setSession = useUserAuthStore((s) => s.setSession);
  const setMustChangePassword = useUserAuthStore(
    (s) => s.setMustChangePassword,
  );

  return useMutation({
    mutationFn: async (payload) => {
      if (IS_DEMO) {
        await demoDelay();
        return demoEnvelope("Password changed successfully", makeDemoSession());
      }
      return changePasswordApi(payload);
    },
    onSuccess: (response) => {
      const session = response.data;
      const token = session?.token || session?.accessToken?.token;
      if (token) setSession(token, session?.refreshToken?.token);
      setMustChangePassword(false);

      Toast.show({
        type: "success",
        text1: "Password changed successfully",
        text2: IS_DEMO
          ? "Demo mode — nothing was saved"
          : "You were signed out on your other devices.",
      });
    },
    onError: (error) => {
      Toast.show({
        type: "error",
        text1: "Failed to change password",
        text2: apiMessage(error),
      });
    },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// useLogout
// ─────────────────────────────────────────────────────────────────────────────
export const useLogout = () => {
  const logout = useUserAuthStore((s) => s.logout);
  const refreshToken = useUserAuthStore((s) => s.refreshToken);
  const queryClient = useQueryClient();

  const clearLocal = () => {
    logout();
    clearCsrfToken();
    // Drop every cached response (clips, sessions, permissions…) so the next
    // person to sign in on this phone never sees the last one's data.
    queryClient.clear();
  };

  return useMutation({
    mutationFn: async () => {
      if (IS_DEMO) return demoEnvelope("Logout successful");
      return logoutApi(refreshToken);
    },
    onSuccess: () => {
      clearLocal();
      Toast.show({ type: "success", text1: "Logged out successfully" });
    },
    onError: () => {
      // Clear local state even if the server call fails, so a network error
      // can never trap someone in a signed-in state.
      clearLocal();
    },
  });
};
