// PLAN-009 phase C: Open Play — sessions, their spots and weekly series (/api/v1/admin/open-play)
import { createAxiosInstanceWithInterceptor, userTypeAuth } from "../axios";

const api = createAxiosInstanceWithInterceptor("data", userTypeAuth.admin);
const BASE = "/api/v1/admin/open-play";

// { venues: [{ venueId, name, courts: [{ courtId, name }] }] }
export const getOpenPlayOptionsApi = async () => {
  const response = await api.get(`${BASE}/options`);
  return response.data;
};

// { sessions: [...], pagination } — filters: { venueId, when, kind, page, pageSize }
export const getPlaySessionsApi = async (filters = {}) => {
  const response = await api.get(`${BASE}/sessions`, { params: filters });
  return response.data;
};

// { session: { …, courts: [{ courtId, name }] }, signups: [...] }
export const getPlaySessionApi = async (playSessionId) => {
  const response = await api.get(`${BASE}/sessions/${playSessionId}`);
  return response.data;
};

// One session → { playSessionId, shareUrl }; with `repeat` a weekly series → { seriesId, made }
export const createPlaySessionApi = async (body) => {
  const response = await api.post(`${BASE}/sessions`, body);
  return response.data;
};

export const updatePlaySessionApi = async ({ playSessionId, body }) => {
  const response = await api.put(`${BASE}/sessions/${playSessionId}`, body);
  return response.data;
};

// Paid spots are refunded → { cancelledSpots }
export const cancelPlaySessionApi = async ({ playSessionId, reason }) => {
  const response = await api.post(`${BASE}/sessions/${playSessionId}/cancel`, { reason: reason || "" });
  return response.data;
};

// body: { name, phone? } — a walk-in plays free
export const addWalkInApi = async ({ playSessionId, body }) => {
  const response = await api.post(`${BASE}/sessions/${playSessionId}/walk-ins`, body);
  return response.data;
};

export const checkInSpotApi = async (playSignupId) => {
  const response = await api.post(`${BASE}/signups/${playSignupId}/check-in`);
  return response.data;
};

// refund: a paid spot is refunded (needs payments write)
export const cancelSpotApi = async ({ playSignupId, refund }) => {
  const response = await api.post(`${BASE}/signups/${playSignupId}/${refund ? "cancel-refund" : "cancel"}`);
  return response.data;
};

// { series: [...] }
export const getPlaySeriesApi = async (venueId) => {
  const response = await api.get(`${BASE}/series`, { params: venueId ? { venueId } : {} });
  return response.data;
};

export const stopPlaySeriesApi = async (seriesId) => {
  const response = await api.post(`${BASE}/series/${seriesId}/stop`);
  return response.data;
};

// ── PLAN-009 phase D: the queue — every reply is { queue } ───────────────────

// { queue: { paused, courts: [{ courtId, name, game }], next, waiting, resting, notHere, recent } }
export const getPlayQueueApi = async (playSessionId) => {
  const response = await api.get(`${BASE}/sessions/${playSessionId}/queue`);
  return response.data;
};

const queuePost = (path) => async (body) => {
  const response = await api.post(`${BASE}${path(body)}`, body?.data || {});
  return response.data;
};

export const fillQueueApi = queuePost(({ playSessionId }) => `/sessions/${playSessionId}/queue/fill`);
export const lineUpGameApi = queuePost(({ playSessionId }) => `/sessions/${playSessionId}/queue/next`);
export const pauseQueueApi = queuePost(({ playSessionId }) => `/sessions/${playSessionId}/queue/pause`);
export const endPlayGameApi = queuePost(({ playGameId }) => `/games/${playGameId}/end`);
export const voidPlayGameApi = queuePost(({ playGameId }) => `/games/${playGameId}/void`);
export const swapPlayGameApi = queuePost(({ playGameId }) => `/games/${playGameId}/swap`);
export const restSpotApi = queuePost(({ playSignupId }) => `/signups/${playSignupId}/rest`);
