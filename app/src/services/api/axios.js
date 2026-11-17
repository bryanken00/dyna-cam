import axios from "axios";
import Toast from "react-native-toast-message";
import { BASE_URL } from "../../constants";
import { usePairedStore } from "../../store/usePairedStore";
import { useUserAuthStore } from "../../store/useUserAuthStore";

/**
 * Axios instances for the Dyna Cam API (`back/`).
 *
 * The API's rules this file implements — keep it in step with
 * front/src/services/api/axios.js, which does the same for the web portal:
 *
 * • CSRF (double-submit): login, refresh, logout and every authenticated
 *   mutation need an `x-csrf-token` header matching the CSRF cookie. The token
 *   comes from GET /api/v1/admin/auth/csrf-token; the cookie is stored by the
 *   platform's native cookie jar. A 403 `CSRF_VALIDATION_FAILED` refetches the
 *   token and retries once.
 * • Idempotency: every mutation carries an `Idempotency-Key`, kept across
 *   interceptor retries so a retry is the same logical request.
 * • Access token expiry: a 401 refreshes the token pair once (rotation-aware —
 *   concurrent 401s share one refresh) and retries; if that fails, the session
 *   is cleared and Navigation falls back to the login screen.
 * • Forced password change: a 403 `PASSWORD_CHANGE_REQUIRED` flags the user,
 *   and Navigation holds them on the change-password screen.
 */

const AUTH_BASE = "/api/v1/admin/auth";
const MUTATIONS = ["post", "put", "patch", "delete"];

const isMutation = (config) =>
  MUTATIONS.includes(config.method?.toLowerCase());

const newIdempotencyKey = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

// ── CSRF token ───────────────────────────────────────────────────────────────
// Kept in memory only: it is tied to the cookie, which the native cookie jar
// owns, so persisting it would just hand back a stale token after a restart.
let csrfToken = null;
let csrfPromise = null;

// A bare instance with no interceptors, so fetching the token can never loop.
const axiosCsrf = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
});

const fetchCsrfToken = () => {
  if (!csrfPromise) {
    csrfPromise = axiosCsrf
      .get(`${AUTH_BASE}/csrf-token`)
      .then((res) => {
        csrfToken = res.data?.csrfToken ?? null;
        return csrfToken;
      })
      .finally(() => {
        csrfPromise = null;
      });
  }
  return csrfPromise;
};

export const clearCsrfToken = () => {
  csrfToken = null;
};

/** Adds the CSRF token and an Idempotency-Key to a mutation. */
const withMutationHeaders = async (config) => {
  if (!isMutation(config)) return config;
  if (!csrfToken) {
    try {
      await fetchCsrfToken();
    } catch {
      // Let the request go; the server's 403 is the clearer error to show.
    }
  }
  if (csrfToken) config.headers["x-csrf-token"] = csrfToken;
  if (!config.headers["Idempotency-Key"]) {
    config.headers["Idempotency-Key"] = newIdempotencyKey();
  }
  return config;
};

/** On a CSRF failure, refetch the token and retry once. Returns null if not a CSRF failure. */
const retryOnCsrfFailure = async (instance, error) => {
  const original = error.config;
  if (
    error.response?.status !== 403 ||
    error.response?.data?.code !== "CSRF_VALIDATION_FAILED" ||
    original?._csrfRetry
  ) {
    return null;
  }
  original._csrfRetry = true;
  clearCsrfToken();
  await fetchCsrfToken();
  original.headers["x-csrf-token"] = csrfToken;
  return instance(original);
};

const createBaseInstance = (type) =>
  axios.create({
    baseURL: BASE_URL,
    // Cookies (the CSRF cookie) are kept by the native cookie jar on
    // iOS/Android; on web the browser only sends them with credentials on.
    withCredentials: true,
    headers:
      type === "multipart"
        ? { "Content-Type": "multipart/form-data" }
        : { "Content-Type": "application/json" },
  });

// ── Unauthenticated instance (login, refresh, logout) ────────────────────────
export const axiosAuth = createBaseInstance("data");
axiosAuth.interceptors.request.use(withMutationHeaders);
axiosAuth.interceptors.response.use(
  (response) => response,
  async (error) =>
    (await retryOnCsrfFailure(axiosAuth, error)) ?? Promise.reject(error),
);

// ── Token refresh (rotation-aware) ───────────────────────────────────────────
// One in-flight refresh at a time: the API revokes a refresh token when it is
// used, so two parallel refreshes would invalidate each other.
let refreshPromise = null;

const performTokenRefresh = async () => {
  const { refreshToken, setSession } = useUserAuthStore.getState();
  if (!refreshToken) throw new Error("No refresh token available");

  const response = await axiosAuth.post(`${AUTH_BASE}/refresh`, {
    refreshToken,
  });
  const data = response.data?.data;
  const newToken = data?.token || data?.accessToken?.token;
  if (!newToken) throw new Error("Refresh response did not include a token");

  setSession(newToken, data?.refreshToken?.token);
  return newToken;
};

const getRefreshedToken = () => {
  if (!refreshPromise) {
    refreshPromise = performTokenRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
};

const handleSessionExpired = () => {
  const { token, logout } = useUserAuthStore.getState();
  logout();
  clearCsrfToken();
  if (token) {
    Toast.show({
      type: "error",
      text1: "Session expired",
      text2: "Please sign in again.",
    });
  }
};

// ── Authenticated instances ──────────────────────────────────────────────────
const instanceCache = new Map();

/**
 * @param {"data" | "multipart"} type - JSON body or multipart/form-data
 */
export const createAxiosInstanceWithInterceptor = (type = "data") => {
  if (instanceCache.has(type)) return instanceCache.get(type);

  const instance = createBaseInstance(type);

  instance.interceptors.request.use(async (config) => {
    const { token } = useUserAuthStore.getState();
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return withMutationHeaders(config);
  });

  instance.interceptors.response.use(
    (response) => response,
    async (error) => {
      const retried = await retryOnCsrfFailure(instance, error);
      if (retried) return retried;

      const status = error.response?.status;
      const code = error.response?.data?.code;
      const original = error.config;

      // The account must change its password before anything else works.
      if (status === 403 && code === "PASSWORD_CHANGE_REQUIRED") {
        useUserAuthStore.getState().setMustChangePassword(true);
        return Promise.reject(error);
      }

      // Expired/invalid access token: refresh once, then retry. A wrong
      // password typed into a form (INVALID_CREDENTIALS) is not a session
      // problem and must not sign the user out.
      if (status === 401 && code !== "INVALID_CREDENTIALS" && original) {
        if (original._authRetry) {
          handleSessionExpired();
          return Promise.reject(error);
        }
        original._authRetry = true;
        try {
          const newToken = await getRefreshedToken();
          original.headers.Authorization = `Bearer ${newToken}`;
          return instance(original);
        } catch {
          handleSessionExpired();
          return Promise.reject(error);
        }
      }

      return Promise.reject(error);
    },
  );

  instanceCache.set(type, instance);
  return instance;
};

// ─────────────────────────────────────────────────────────────────────────────
// Paired staff phones (PLAN-002) — a separate credential, a separate instance
// ─────────────────────────────────────────────────────────────────────────────
//
// A paired phone holds an app token (store/usePairedStore.js, kept in
// expo-secure-store) and calls /api/v1/app/* with `Authorization: App <token>`.
// None of the staff-account machinery applies: no Bearer, no CSRF (those
// routes don't use cookies), no refresh — the token lives until the phone is
// revoked on the web.
//
// ⚠️ The token is a secret. Nothing in this file logs a request, a response
// or an error object — an axios error carries `config.headers`, which holds
// the token, and POST /pair/app's response body holds it too. Keep it that
// way: never console.log/console.error an axios error from the paired paths.

/** No credentials at all — POST /api/v1/pair/app (the 6-digit key is the credential). */
export const axiosPair = axios.create({
  baseURL: BASE_URL,
  headers: { "Content-Type": "application/json" },
});

let pairedInstance = null;

/**
 * The paired-phone instance. Its one piece of session logic:
 *
 *  • 401 with code TOKEN_INVALID → the phone was revoked (or the token is
 *    gone): clear the pairing, and Navigation falls back to "Pair this phone"
 *    with a notice. Only when the failed request carried the CURRENT token,
 *    so a slow request from an old pairing can't unpair a new one.
 *  • anything else — no response (Wi-Fi down, server unreachable), 5xx, 4xx
 *    — is just an error for the screen to show. The phone stays paired.
 */
export const createPairedAxiosInstance = () => {
  if (pairedInstance) return pairedInstance;

  const instance = axios.create({
    baseURL: BASE_URL,
    headers: { "Content-Type": "application/json" },
  });

  instance.interceptors.request.use((config) => {
    const { token } = usePairedStore.getState();
    if (token) config.headers.Authorization = `App ${token}`;
    // Lets the API replay a Record that was retried after a dropped reply
    if (isMutation(config) && !config.headers["Idempotency-Key"]) {
      config.headers["Idempotency-Key"] = newIdempotencyKey();
    }
    return config;
  });

  instance.interceptors.response.use(
    (response) => response,
    (error) => {
      const { token, unpair } = usePairedStore.getState();
      const sentWith = error.config?.headers?.Authorization;
      if (
        error.response?.status === 401 &&
        error.response?.data?.code === "TOKEN_INVALID" &&
        token &&
        sentWith === `App ${token}`
      ) {
        unpair("This phone was unpaired — enter a new key");
      }
      return Promise.reject(error);
    },
  );

  pairedInstance = instance;
  return instance;
};
