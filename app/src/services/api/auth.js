/**
 * API — Admin Auth
 * All functions return response.data — the API's envelope
 * `{ success, message, data }` — with no side effects and no store writes.
 * The routes are the same ones the web Admin portal uses.
 */
import { axiosAuth, createAxiosInstanceWithInterceptor } from "./axios";

const axiosDefault = createAxiosInstanceWithInterceptor("data");

const BASE = "/api/v1/admin/auth";

/** data: { user, token, accessToken: { token, … }, refreshToken: { token, … } } */
export const loginApi = async (payload) => {
  const response = await axiosAuth.post(`${BASE}/login`, payload);
  return response.data;
};

/** data: { user } */
export const getMeApi = async () => {
  const response = await axiosDefault.get(`${BASE}/me`);
  return response.data;
};

/**
 * payload: { currentPassword, newPassword }
 * data: a new session — { token, accessToken, refreshToken }. Every other
 * session of the account is ended, so the caller must store these.
 */
export const changePasswordApi = async (payload) => {
  const response = await axiosDefault.put(`${BASE}/me/password`, payload);
  return response.data;
};

/** Revokes the refresh token server-side. Always succeeds. */
export const logoutApi = async (refreshToken) => {
  const response = await axiosAuth.post(
    `${BASE}/logout`,
    refreshToken ? { refreshToken } : {},
  );
  return response.data;
};
