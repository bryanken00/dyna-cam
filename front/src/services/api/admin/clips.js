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

// Staff save: the last 60 seconds on a court, now.
// 201 { clipId, shareUrl, merged: false } · 200 { …, merged: true }
// 503 CAMERA_OFFLINE · 404 court not found / not active
export const createClipApi = async (clipData) => {
  const response = await api.post("/api/v1/admin/clips", clipData);
  return response.data;
};

export const deleteClipApi = async (clipId) => {
  const response = await api.delete(`/api/v1/admin/clips/${clipId}`);
  return response.data;
};
