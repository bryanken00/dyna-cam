import axios from "axios";
import { BASE_URL } from "../../constants";
import { usePairedStore } from "../../store/usePairedStore";
import { usePlayerStore } from "../../store/usePlayerStore";

/**
 * Axios instances for the DGSports API (`back/`). Two credentials, one per
 * app mode (PLAN-009):
 *
 *  • Courtside device (PLAN-002 Phase E): the token a device gets when it is
 *    paired to a recording session with a 6-digit key
 *    (store/usePairedStore.js). It calls `/api/v1/app/*` with
 *    `Authorization: App <token>` and simply stops working when the session's
 *    grace period ends — no refresh.
 *  • Player: PLAN-006's player tokens (store/usePlayerStore.js) on
 *    `/api/v1/player/*` and the booking routes, `Authorization: Player
 *    <token>`, refreshed here when the 15-minute access token runs out.
 *
 * No staff sign-in, Bearer token, CSRF or cookies: staff work is on the web.
 *
 * ⚠️ Every token is a secret, and so is the `sig` on a live-video link. Nothing
 * in this file logs a request, a response or an error object — an axios error
 * carries `config.headers` (the token), POST /pair/app's response holds the
 * token, and GET /app/session's holds the signed live link. Never
 * console.log / console.error an axios error, a response, or `live.hlsUrl`.
 */

const MUTATIONS = ["post", "put", "patch", "delete"];

const isMutation = (config) =>
  MUTATIONS.includes(config.method?.toLowerCase());

const newIdempotencyKey = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

/**
 * No credentials at all — POST /api/v1/pair/app (the 6-digit key is the
 * credential), the public venue list, and the player's session routes (the
 * sign-in code or refresh token is in the body).
 */
export const axiosPair = axios.create({
  baseURL: BASE_URL,
  headers: { "Content-Type": "application/json" },
});
export const axiosPublic = axiosPair;

let deviceInstance = null;

/**
 * The paired-device instance. Its one piece of session logic:
 *
 *  • 401 with code TOKEN_INVALID → the device is no longer paired (the
 *    session's 10-minute grace ran out, staff cancelled the session, or they
 *    unpaired the device on the web): clear the pairing, and Navigation goes
 *    back to "Pair this device" with a notice. Only when the failed request
 *    carried the CURRENT token, so a slow request from an old pairing can't
 *    unpair a new one.
 *  • anything else — no response (Wi-Fi down, server unreachable), 5xx, a
 *    409 — is just an error for the screen to show. The device stays paired.
 */
export const createDeviceAxiosInstance = () => {
  if (deviceInstance) return deviceInstance;

  const instance = axios.create({
    baseURL: BASE_URL,
    headers: { "Content-Type": "application/json" },
  });

  instance.interceptors.request.use((config) => {
    const { token } = usePairedStore.getState();
    if (token) config.headers.Authorization = `App ${token}`;
    // Lets the API replay a Stop that was retried after a dropped reply
    if (isMutation(config) && !config.headers["Idempotency-Key"]) {
      config.headers["Idempotency-Key"] = newIdempotencyKey();
    }
    return config;
  });

  instance.interceptors.response.use(
    (response) => response,
    (error) => {
      const { token, sessionEnded, unpair } = usePairedStore.getState();
      const sentWith = error.config?.headers?.Authorization;
      if (
        error.response?.status === 401 &&
        error.response?.data?.code === "TOKEN_INVALID" &&
        token &&
        sentWith === `App ${token}`
      ) {
        unpair(
          sessionEnded
            ? "The session has ended — this device is unpaired."
            : "This device was unpaired — enter a new key.",
        );
      }
      return Promise.reject(error);
    },
  );

  deviceInstance = instance;
  return instance;
};

// ─────────────────────────────────────────────────────────────────────────────
// Player (PLAN-009)
// ─────────────────────────────────────────────────────────────────────────────

/** One refresh at a time: every request that hit an expired token waits for it. */
let refreshing = null;

const refreshPlayerTokens = () => {
  if (!refreshing) {
    const { refreshToken } = usePlayerStore.getState();
    refreshing = axiosPublic
      .post("/api/v1/player/session/refresh", { refreshToken })
      .then((res) => {
        // Only if nobody signed out (or in as someone else) meanwhile
        if (usePlayerStore.getState().refreshToken === refreshToken) {
          usePlayerStore.getState().setTokens(res.data.data);
        }
        return usePlayerStore.getState().accessToken;
      })
      .catch((error) => {
        // Refused (revoked, used twice, expired): signed out. No answer / 5xx: stay signed in.
        if (
          error.response?.status === 401 &&
          usePlayerStore.getState().refreshToken === refreshToken
        ) {
          usePlayerStore.getState().signOut("You were signed out — sign in again.");
        }
        throw error;
      })
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
};

let playerInstance = null;

/**
 * The signed-in player's instance:
 *
 *  • 401 on a request sent with the CURRENT access token → refresh once (the
 *    refresh token rotates) and send it again. A refused refresh signs out.
 *  • anything else — no response, 5xx, 4xx — is an error for the screen.
 */
export const createPlayerAxiosInstance = () => {
  if (playerInstance) return playerInstance;

  const instance = axios.create({
    baseURL: BASE_URL,
    headers: { "Content-Type": "application/json" },
  });

  instance.interceptors.request.use((config) => {
    const { accessToken } = usePlayerStore.getState();
    if (accessToken) config.headers.Authorization = `Player ${accessToken}`;
    if (isMutation(config) && !config.headers["Idempotency-Key"]) {
      config.headers["Idempotency-Key"] = newIdempotencyKey();
    }
    return config;
  });

  instance.interceptors.response.use(
    (response) => response,
    async (error) => {
      const config = error.config;
      const { accessToken, refreshToken } = usePlayerStore.getState();
      const sentWith = config?.headers?.Authorization;
      if (
        error.response?.status === 401 &&
        config &&
        !config._retried &&
        refreshToken &&
        sentWith === `Player ${accessToken}`
      ) {
        config._retried = true;
        const fresh = await refreshPlayerTokens();
        config.headers.Authorization = `Player ${fresh}`;
        return instance(config);
      }
      return Promise.reject(error);
    },
  );

  playerInstance = instance;
  return instance;
};
