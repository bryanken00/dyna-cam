import { createAxiosInstanceWithInterceptor, userTypeAuth } from "../axios";

const api = createAxiosInstanceWithInterceptor("data", userTypeAuth.admin);

export const getDashboardStatsApi = async () => {
  const response = await api.get("/api/v1/admin/dashboard/stats");
  return response.data;
};

/** CR-008: today at the venues (games, clips, cash, boxes and cameras up). */
export const getDashboardVenuesApi = async () => {
  const response = await api.get("/api/v1/admin/dashboard/venues");
  return response.data;
};

/** CR-008: open problems and every recorder box's health (Venue alerts permission). */
export const getDashboardAlertsApi = async () => {
  const response = await api.get("/api/v1/admin/dashboard/alerts");
  return response.data;
};
