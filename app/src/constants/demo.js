/**
 * Fixtures used when `IS_DEMO` is on (see `constants/index.js`).
 *
 * Nothing here is reachable when demo mode is off — every consumer is behind
 * an `IS_DEMO` check in `services/requests/auth.js`.
 *
 * The fixtures mirror the real API's responses (the `{ success, message, data }`
 * envelope and the `user` object from POST /api/v1/admin/auth/login), so the
 * hooks' `onSuccess` needs no demo branch.
 */

/** Fake latency, so loading states are actually visible while developing. */
export const DEMO_LATENCY_MS = 600;

/** Not real credentials — demo mode never sends them anywhere. */
export const DEMO_TOKEN = "demo-token-not-a-real-jwt";
export const DEMO_REFRESH_TOKEN = "demo-refresh-token-not-a-real-jwt";

/**
 * Shaped like the `user` the API returns on login and from GET /auth/me.
 *
 * @param {string} email - whatever was typed on the login form
 */
export const makeDemoUser = (email) => ({
  accountId: "demo-user-1",
  firstName: "Demo",
  lastName: "User",
  email: email || "demo@example.com",
  roleId: "demo-role",
  roleName: "Demo",
  status: "Active",
  type: "ADMIN",
  mustChangePassword: false,
});

/** A session payload shaped like the API's (login, refresh, change-password). */
export const makeDemoSession = () => ({
  token: DEMO_TOKEN,
  accessToken: { token: DEMO_TOKEN },
  refreshToken: { token: DEMO_REFRESH_TOKEN },
});

/** Wraps a payload in the API's response envelope. */
export const demoEnvelope = (message, data = null) => ({
  success: true,
  message,
  data,
});

/** Resolves after DEMO_LATENCY_MS — keeps demo mutations async like real ones. */
export const demoDelay = () =>
  new Promise((resolve) => setTimeout(resolve, DEMO_LATENCY_MS));
