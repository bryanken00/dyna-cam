// PLAN-009 phase F: clubs and their members (/api/v1/admin/clubs)
import { createAxiosInstanceWithInterceptor, userTypeAuth } from "../axios";

const api = createAxiosInstanceWithInterceptor("data", userTypeAuth.admin);
const BASE = "/api/v1/admin/clubs";

// { clubs: [{ clubId, venueId, venueName, name, description, joinPolicy, status, members, pending, shareUrl }] }
export const getClubsApi = async (filters = {}) => (await api.get(BASE, { params: filters })).data;
// { club, members: [{ clubMemberId, name, email, phone, skillLevel, role, status, joinedAt }] }
export const getClubApi = async (clubId) => (await api.get(`${BASE}/${clubId}`)).data;
export const createClubApi = async (body) => (await api.post(BASE, body)).data;
export const updateClubApi = async ({ clubId, body }) => (await api.put(`${BASE}/${clubId}`, body)).data;
export const deleteClubApi = async (clubId) => (await api.delete(`${BASE}/${clubId}`)).data;
// body: { status?: "Active"|"Removed", role?: "Member"|"Admin" }
export const updateClubMemberApi = async ({ clubMemberId, body }) => (await api.put(`${BASE}/members/${clubMemberId}`, body)).data;

// { venues: [{ venueId, name }] } — the club form
export const getClubOptionsApi = async () => (await api.get(`${BASE}/options`)).data;
