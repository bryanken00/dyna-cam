import axios from "axios";
import { BASE_URL } from "../../constants";
import { usePairedStore } from "../../store/usePairedStore";

/**
 * Axios instances for the Dyna Cam API (`back/`) — session devices
 * (PLAN-002 Phase E).
 *
 * The app has ONE credential: the token a device gets when it is paired to a
 * recording session with a 6-digit key (store/usePairedStore.js, kept in
 * expo-secure-store). It calls `/api/v1/app/*` with `Authorization: App
 * <token>`. There is no staff sign-in in the app any more, so none of the web
 * client's Bearer / CSRF / refresh machinery lives here — those routes use no
 * cookies and the token simply stops working when the session's grace period
 * ends.
 *
 * ⚠️ The token is a secret, and so is the `sig` on a live-video link. Nothing
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

/** No credentials at all — POST /api/v1/pair/app (the 6-digit key is the credential). */
export const axiosPair = axios.create({
  baseURL: BASE_URL,
  headers: { "Content-Type": "application/json" },
});

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
