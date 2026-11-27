// PLAN-009 phase E: tournaments — the event, divisions, teams, the draw, matches (/api/v1/admin/tournaments)
import { createAxiosInstanceWithInterceptor, userTypeAuth } from "../axios";

const api = createAxiosInstanceWithInterceptor("data", userTypeAuth.admin);
const BASE = "/api/v1/admin/tournaments";

const get = (path, params) => async () => (await api.get(`${BASE}${path}`, params ? { params } : undefined)).data;
const send = (method, path) => async (body = {}) => (await api[method](`${BASE}${path(body)}`, body.data || {})).data;

// { venues: [{ venueId, name, courts: [{ courtId, name }] }] }
export const getTournamentOptionsApi = get("/options");
// { tournaments, pagination }
export const getTournamentsApi = async (filters = {}) => (await api.get(BASE, { params: filters })).data;
// { tournament, divisions: [{ …, teams, matches, tables }] }
export const getTournamentApi = async (tournamentId) => (await api.get(`${BASE}/${tournamentId}`)).data;

export const createTournamentApi = async (body) => (await api.post(BASE, body)).data;
export const updateTournamentApi = send("put", ({ tournamentId }) => `/${tournamentId}`);
export const setTournamentStatusApi = send("post", ({ tournamentId }) => `/${tournamentId}/status`);
export const cancelTournamentApi = send("post", ({ tournamentId }) => `/${tournamentId}/cancel`);

export const createDivisionApi = send("post", ({ tournamentId }) => `/${tournamentId}/divisions`);
export const updateDivisionApi = send("put", ({ divisionId }) => `/divisions/${divisionId}`);
export const deleteDivisionApi = async ({ divisionId }) => (await api.delete(`${BASE}/divisions/${divisionId}`)).data;
export const addStaffTeamApi = send("post", ({ divisionId }) => `/divisions/${divisionId}/teams`);
export const generateDrawApi = send("post", ({ divisionId }) => `/divisions/${divisionId}/draw`);

export const setTeamSeedApi = send("put", ({ tournamentTeamId }) => `/teams/${tournamentTeamId}/seed`);
export const withdrawTeamApi = send("post", ({ tournamentTeamId, refund }) => `/teams/${tournamentTeamId}/${refund ? "withdraw-refund" : "withdraw"}`);

export const scheduleMatchApi = send("put", ({ matchId }) => `/matches/${matchId}`);
export const callMatchApi = send("post", ({ matchId }) => `/matches/${matchId}/call`);
export const scoreMatchApi = send("post", ({ matchId }) => `/matches/${matchId}/score`);
