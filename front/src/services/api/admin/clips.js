import { createAxiosInstanceWithInterceptor, userTypeAuth } from "../axios";

const api = createAxiosInstanceWithInterceptor("data", userTypeAuth.admin);

// Venues + courts for the Sessions filters and New game (clips permission).
// CR-024: the Clips list page is gone, so its list / by-ID calls are too.
export const getClipOptionsApi = async () => {
  const response = await api.get("/api/v1/admin/clips/options");
  return response.data;
};
