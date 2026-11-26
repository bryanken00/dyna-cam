import { createAxiosInstanceWithInterceptor, userTypeAuth } from "../axios";

/** PLAN-008 phase E: super admins — /api/v1/backoffice/admins. */
const backofficeApi = () => createAxiosInstanceWithInterceptor("data", userTypeAuth.backoffice);

// { status? } → { admins: [{ platformAdminId, firstName, lastName, email, status, mustChangePassword, lastSignInAt, isSelf }] }
export const getAdminsApi = async (params) => {
  const response = await backofficeApi().get("/api/v1/backoffice/admins", { params });
  return response.data;
};

// { firstName, lastName, email } → { platformAdminId, email, temporaryPassword }
export const createAdminApi = async (payload) => {
  const response = await backofficeApi().post("/api/v1/backoffice/admins", payload);
  return response.data;
};

// { platformAdminId, data: { firstName, lastName } } → { admin }
export const updateAdminApi = async ({ platformAdminId, data }) => {
  const response = await backofficeApi().patch(`/api/v1/backoffice/admins/${platformAdminId}`, data);
  return response.data;
};

export const deactivateAdminApi = async (platformAdminId) => {
  const response = await backofficeApi().post(`/api/v1/backoffice/admins/${platformAdminId}/deactivate`);
  return response.data;
};

export const reactivateAdminApi = async (platformAdminId) => {
  const response = await backofficeApi().post(`/api/v1/backoffice/admins/${platformAdminId}/reactivate`);
  return response.data;
};

// → { email, temporaryPassword }
export const resetAdminPasswordApi = async (platformAdminId) => {
  const response = await backofficeApi().post(`/api/v1/backoffice/admins/${platformAdminId}/reset-password`);
  return response.data;
};
