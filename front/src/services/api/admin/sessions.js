import { createAxiosInstanceWithInterceptor, userTypeAuth } from "../axios";

const api = createAxiosInstanceWithInterceptor("data", userTypeAuth.admin);

export const getSessionsApi = async (filters = {}) => {
  const response = await api.get("/api/v1/admin/sessions", { params: filters });
  return response.data;
};

// { session: { …, parts: [...] } }
export const getSessionByIdApi = async (sessionId) => {
  const response = await api.get(`/api/v1/admin/sessions/${sessionId}`);
  return response.data;
};

// { courtId, startAt: "YYYY-MM-DD HH:mm" (Manila), durationMinutes, playerName?, phone? }
// → 201 { sessionId, startAt, endAt, shareUrl } · 409 overlapping session
export const createSessionApi = async (sessionData) => {
  const response = await api.post("/api/v1/admin/sessions", sessionData);
  return response.data;
};

// Only before it starts — 409 otherwise
export const cancelSessionApi = async (sessionId) => {
  const response = await api.post(`/api/v1/admin/sessions/${sessionId}/cancel`);
  return response.data;
};

// Finish a recording session now — 409 if it isn't recording
export const endSessionApi = async (sessionId) => {
  const response = await api.post(`/api/v1/admin/sessions/${sessionId}/end`);
  return response.data;
};
