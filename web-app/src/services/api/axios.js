import axios from "axios";

/**
 * PLAN-009: the player app's plain axios instance — the no-login player routes
 * (`/api/v1/public/*`) and the player session routes. The API is on the same
 * origin (`/api/v1` is proxied by Vite in development and by the web server in
 * production). There's no staff login here, so no CSRF token: the API checks
 * one only on the Admin routes. Signed-in calls go through `playerAxios`
 * (services/api/public/player.js).
 */
export const axiosInstance = axios.create({
  headers: {
    "Content-Type": "application/json",
  },
  withCredentials: true,
});

const IDEMPOTENCY_PROTECTED_METHODS = ["post", "patch", "put", "delete"];

/**
 * A unique Idempotency-Key. Not crypto.randomUUID(): browsers only have it on
 * https / localhost, and the app is also opened over plain http on the LAN.
 */
export const generateIdempotencyKey = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

// Mutations carry an Idempotency-Key; a retry keeps the same one
axiosInstance.interceptors.request.use((config) => {
  const method = config.method?.toLowerCase();
  if (IDEMPOTENCY_PROTECTED_METHODS.includes(method) && !config.headers["Idempotency-Key"]) {
    config.headers["Idempotency-Key"] = generateIdempotencyKey();
  }
  return config;
});

export default axiosInstance;
