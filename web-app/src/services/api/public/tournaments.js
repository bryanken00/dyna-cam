// PLAN-009 phase E: tournaments for anyone, no login (/api/v1/public/tournaments).
// A signed-in player's register / join / pay / withdraw are in ./player.js (playerAxios).
import axiosInstance from "../axios";

// → { tournaments: [{ key, name, startDate, endDate, registrationOpen, status, venue, divisions }] }
export const getTournamentsApi = async () => (await axiosInstance.get("/api/v1/public/tournaments")).data;

// → { tournament, divisions: [{ key, name, teamSize, entryFee, spotsLeft, format, drawOut, teams, matches, tables }] }
export const getTournamentApi = async (key) => (await axiosInstance.get(`/api/v1/public/tournaments/${key}`)).data;

// The team an invite joins → { invite: { teamName, captain, divisionName, tournamentName, tournamentKey, … } }
export const getTeamInviteApi = async (inviteToken) =>
  (await axiosInstance.get(`/api/v1/public/tournaments/invites/${inviteToken}`)).data;
