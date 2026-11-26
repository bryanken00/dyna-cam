import {
  axiosInstance,
  createAxiosInstanceWithInterceptor,
  getUserToken,
  userTypeAuth,
} from "../axios";

/**
 * PLAN-008 phase B: the back office's sign-in (DGSports super admins) —
 * /api/v1/backoffice/auth/*. Its own tokens (useBackofficeAuthStore).
 */
const backofficeApi = () => createAxiosInstanceWithInterceptor("data", userTypeAuth.backoffice);

// → { token, refreshToken: { token }, admin }
export const loginBackofficeApi = async (payload) => {
  const response = await axiosInstance.post("/api/v1/backoffice/auth/login", payload);
  return response.data;
};

export const logoutBackofficeApi = async () => {
  const refreshToken = getUserToken(userTypeAuth.backoffice)?.refreshToken;
  const response = await axiosInstance.post(
    "/api/v1/backoffice/auth/logout",
    refreshToken ? { refreshToken } : {},
  );
  return response.data;
};

export const getBackofficeCsrfTokenApi = async () => {
  const response = await axiosInstance.get("/api/v1/backoffice/auth/csrf-token");
  return response.data;
};

// → { admin }
export const getBackofficeMeApi = async () => {
  const response = await backofficeApi().get("/api/v1/backoffice/auth/me");
  return response.data;
};

// { currentPassword, newPassword } → a new session { token, refreshToken, admin }
export const changeBackofficePasswordApi = async (payload) => {
  const response = await backofficeApi().put("/api/v1/backoffice/auth/me/password", payload);
  return response.data;
};
