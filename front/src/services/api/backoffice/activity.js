import { createAxiosInstanceWithInterceptor, userTypeAuth } from "../axios";

/**
 * PLAN-008 phase E: the back office's audit trail — /api/v1/backoffice/activity.
 * { companyId?, platformAdminId?, action?, dateFrom?, dateTo?, page, pageSize }
 * → { activity: [{ auditId, action, description, metadata, ipAddress, dateCreated, admin, company }],
 *     actions: [...], pagination }
 */
export const getActivityApi = async (params) => {
  const response = await createAxiosInstanceWithInterceptor("data", userTypeAuth.backoffice).get(
    "/api/v1/backoffice/activity",
    { params },
  );
  return response.data;
};
