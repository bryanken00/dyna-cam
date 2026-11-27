import {
  axiosInstance,
  createAxiosInstanceWithInterceptor,
  userTypeAuth,
} from "./axios";

// ─── Public (no auth) — CSRF is auto-handled by the axiosInstance interceptor ──

export const forgotPasswordApi = async (email) => {
  const response = await axiosInstance.post(
    "/api/v1/admin/auth/forgot-password",
    { email },
  );
  return response.data;
};

export const resetPasswordApi = async ({ token, password }) => {
  const response = await axiosInstance.post(
    "/api/v1/admin/auth/reset-password",
    { token, password },
  );
  return response.data;
};

// ─── Authenticated (self-service profile) ─────────────────────────────────────

const api = createAxiosInstanceWithInterceptor("data", userTypeAuth.admin);

export const getMeApi = async () => {
  const response = await api.get("/api/v1/admin/auth/me");
  return response.data;
};

export const updateProfileApi = async (payload) => {
  const response = await api.put("/api/v1/admin/auth/me", payload);
  return response.data;
};

export const changePasswordApi = async (payload) => {
  const response = await api.put("/api/v1/admin/auth/me/password", payload);
  return response.data;
};
