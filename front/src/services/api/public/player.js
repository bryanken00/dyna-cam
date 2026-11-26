// PLAN-006: a player signed in with Google. The session routes use the plain
// axiosInstance; everything else goes through playerAxios, which sends
// `Authorization: Player <access token>` and renews it with the refresh token
// (once per expiry, shared by every request waiting on it).
import axios from "axios";

import axiosInstance, { generateIdempotencyKey } from "../axios";
import { usePlayerStore } from "../../../store/playerStore";

/** Where the browser goes to sign in; Google brings it back to /signed-in → returnPath. */
export const playerSignInUrl = (returnPath) =>
  `/api/v1/auth/google/start?return=${encodeURIComponent(returnPath)}`;

// Trade the sign-in page's single-use code → { accessToken: { token }, refreshToken: { token } }
export const startPlayerSessionApi = async (code) => {
  const response = await axiosInstance.post("/api/v1/player/session", { code });
  return response.data;
};

// End this browser's session (the refresh token stops working)
export const logoutPlayerApi = async (refreshToken) => {
  const response = await axiosInstance.post("/api/v1/player/session/logout", { refreshToken });
  return response.data;
};

let refreshing = null;

/**
 * A fresh access token from the stored refresh token. A 401 means the session
 * is over (signed out elsewhere, blocked, or a copied token) → signed out here.
 * @returns {Promise<string>}
 */
export const refreshPlayerSession = () => {
  if (!refreshing) {
    const { refreshToken } = usePlayerStore.getState();
    const request = refreshToken
      ? axiosInstance.post("/api/v1/player/session/refresh", { refreshToken })
      : Promise.reject(new Error("Not signed in"));
    refreshing = request
      .then((response) => {
        const { accessToken, refreshToken: next } = response.data.data;
        usePlayerStore.getState().setSession({
          accessToken: accessToken.token,
          refreshToken: next.token,
        });
        return accessToken.token;
      })
      .catch((error) => {
        if (!refreshToken || error?.response?.status === 401) usePlayerStore.getState().clear();
        throw error;
      })
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
};

const playerAxios = axios.create({ headers: { "Content-Type": "application/json" } });

playerAxios.interceptors.request.use(async (config) => {
  const token = usePlayerStore.getState().accessToken || (await refreshPlayerSession());
  config.headers.Authorization = `Player ${token}`;
  if (config.method?.toLowerCase() === "post" && !config.headers["Idempotency-Key"]) {
    // Not crypto.randomUUID(): browsers only have it on https / localhost, and the
    // player pages are also opened over plain http on the LAN in development
    config.headers["Idempotency-Key"] = generateIdempotencyKey();
  }
  return config;
});

playerAxios.interceptors.response.use(undefined, async (error) => {
  const { config, response } = error;
  if (response?.status === 401 && response.data?.code === "TOKEN_EXPIRED" && !config._retried) {
    config._retried = true;
    usePlayerStore.getState().setAccessToken(null);
    const token = await refreshPlayerSession();
    config.headers.Authorization = `Player ${token}`;
    return playerAxios(config);
  }
  // Blocked, signed out elsewhere, or no session: this browser is signed out too
  if (response?.status === 401) usePlayerStore.getState().clear();
  return Promise.reject(error);
});

// The signed-in player → { player: { firstName, middleName, lastName, name, email, photoUrl,
// phone, profileComplete } } — until profileComplete, the names are Google's (to pre-fill)
export const getPlayerMeApi = async () => {
  const response = await playerAxios.get("/api/v1/player/me");
  return response.data;
};

// Save the profile (first sign-in, or later). body: { firstName, middleName?, lastName, phone }
export const updatePlayerProfileApi = async (body) => {
  const response = await playerAxios.patch("/api/v1/player/me", body);
  return response.data;
};

// The game log → { upcoming: [booking], past: [booking], pagination }
// booking: { bookingCode, venueName, courtName, startAt, endAt, status, paymentStatus, price,
//            bookingUrl, games: [{ startAt, endAt, status, gameUrl, driveUrl }] }
export const getPlayerGamesApi = async ({ page = 1, limit = 10 } = {}) => {
  const response = await playerAxios.get("/api/v1/player/games", { params: { page, limit } });
  return response.data;
};

// Book as the signed-in player. body: { date, slots: [{ courtKey, startTime }], phone?, payMethod }
// (CR-047: neighbouring hours on a court join into one booking; several are paid in one checkout)
// 201 { bookingCode, manageToken, manageUrl, checkoutUrl, bookings: [...], total } — the first
// booking's links; checkoutUrl pays everything
export const createPlayerBookingApi = async ({ bookingToken, body }) => {
  const response = await playerAxios.post(`/api/v1/public/book/${bookingToken}/bookings`, body);
  return response.data;
};
