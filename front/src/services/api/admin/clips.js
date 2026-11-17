import { createAxiosInstanceWithInterceptor, userTypeAuth } from "../axios";

const api = createAxiosInstanceWithInterceptor("data", userTypeAuth.admin);

export const getClipsApi = async (filters = {}) => {
  const response = await api.get("/api/v1/admin/clips", { params: filters });
  return response.data;
};

// Venues + courts for the Clips filters (clips permission)
export const getClipOptionsApi = async () => {
  const response = await api.get("/api/v1/admin/clips/options");
  return response.data;
};

export const getClipByIdApi = async (clipId) => {
  const response = await api.get(`/api/v1/admin/clips/${clipId}`);
  return response.data;
};
