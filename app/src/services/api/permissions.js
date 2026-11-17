/**
 * API — the signed-in user's permissions
 * Returns response.data — the envelope `{ success, message, data }`.
 *
 * Same call the web portal makes to draw its sidebar
 * (front/src/hooks/usePermissions.js). The route is JWT-only, so it answers
 * even while a password change is pending.
 */
import { createAxiosInstanceWithInterceptor } from "./axios";

const axiosDefault = createAxiosInstanceWithInterceptor("data");

/**
 * data: { permissions: [{ permissionId, module, submodule, description,
 *         accessLevel: "read" | "write", source: "role" | "user" }] }
 * Role permissions merged with the user's overrides; a "none" override is
 * already removed by the API.
 */
export const getMyPermissionsApi = async () => {
  const response = await axiosDefault.get("/api/v1/admin/permissions/user");
  return response.data;
};
