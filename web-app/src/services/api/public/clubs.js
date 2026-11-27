// PLAN-009 phase F: clubs for anyone, no login (/api/v1/public/clubs).
// A signed-in player's join / leave / my clubs are in ./player.js (playerAxios).
import axiosInstance from "../axios";

// → { clubs: [{ key, name, description, joinPolicy, members, venue: { key, name } }] }
export const getClubsApi = async () => (await axiosInstance.get("/api/v1/public/clubs")).data;
// → { club: { …, people: [{ firstName, level, admin }], sessions: [{ key, kind, title, coachName, startAt, … }] } }
export const getClubApi = async (key) => (await axiosInstance.get(`/api/v1/public/clubs/${key}`)).data;
