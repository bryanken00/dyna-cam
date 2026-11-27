// PLAN-009 phase C: Open Play for anyone, no login (/api/v1/public/open-play).
// A signed-in player's join / pay / cancel are in ./player.js (playerAxios).
import axiosInstance from "../axios";

// → { from, days, sessions: [{ key, kind, title, startAt, endAt, state, minLevel, maxLevel,
//     capacity, spotsLeft, pricePerHead, courts, venue: { key, name, address, logoUrl, directionsUrl,
//     latitude, longitude } }] }
// PLAN-009 phase F: kind "OpenPlay" or "Clinic" (coaching); omitted = both
export const getOpenPlaySessionsApi = async ({ from, days = 7, kind } = {}) => {
  const response = await axiosInstance.get("/api/v1/public/open-play", { params: { from, days, kind } });
  return response.data;
};

// → { session: { …, cancelled, payOnline, players: [{ firstName, level }] } }
export const getOpenPlaySessionApi = async (playToken) => {
  const response = await axiosInstance.get(`/api/v1/public/open-play/${playToken}`);
  return response.data;
};
