/**
 * API — the signed-in player (PLAN-006 routes, PLAN-009 app sign-in)
 * Returns response.data — the envelope `{ success, message, data }`.
 * Shape: back/server/src/controllers/v1/player/player.controller.js.
 *
 * ⚠️ The session replies hold the player's tokens — never log them.
 */
import { BASE_URL } from "../../constants";
import { axiosPublic, createPlayerAxiosInstance } from "./axios";

/** Where the app's sign-in comes back to (the API's APP_SCHEME, default dgsports). */
export const APP_SIGNED_IN_URL = "dgsports://signed-in";

/**
 * The page the in-app browser opens: the API sends it on to Google, and
 * Google's answer comes back to dgsports://signed-in?code=… (or ?error=…).
 * `challenge` is the base64url SHA-256 of the app's secret (the verifier).
 */
export const googleStartUrl = (challenge) =>
  `${BASE_URL}/api/v1/auth/google/start?app=1&challenge=${encodeURIComponent(challenge)}`;

/**
 * Trade the single-use code (+ the app's secret) for tokens.
 * 200 data: { accessToken: { token, expiresAt }, refreshToken: { token, expiresAt } }
 * 400 expired / used / wrong secret (the code is then burnt)
 */
export const redeemSignInApi = async ({ code, verifier }) => {
  const response = await axiosPublic.post("/api/v1/player/session", { code, verifier });
  return response.data;
};

/** End this sign-in (the refresh token stops working). */
export const signOutApi = async (refreshToken) => {
  const response = await axiosPublic.post("/api/v1/player/session/logout", { refreshToken });
  return response.data;
};

/**
 * 200 data: { player: { firstName, middleName, lastName, name, email, photoUrl,
 *   phone, profileComplete } }
 */
export const getMeApi = async () => {
  const response = await createPlayerAxiosInstance().get("/api/v1/player/me");
  return response.data;
};

/** payload: { firstName, middleName?, lastName, phone? } → data: { player } */
export const saveProfileApi = async (payload) => {
  const response = await createPlayerAxiosInstance().patch("/api/v1/player/me", payload);
  return response.data;
};

/**
 * The game log: upcoming bookings, then a page of past ones, each with its games.
 * 200 data: { upcoming: [Booking], past: [Booking], pagination }
 * Booking: { bookingCode, venueName, courtName, startAt, endAt, status,
 *   paymentStatus, price, bookingUrl, games: [{ startAt, endAt, status, gameUrl, driveUrl }] }
 */
export const getMyGamesApi = async ({ page = 1, limit = 10 } = {}) => {
  const response = await createPlayerAxiosInstance().get("/api/v1/player/games", {
    params: { page, limit },
  });
  return response.data;
};
