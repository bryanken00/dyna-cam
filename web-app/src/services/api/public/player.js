// PLAN-006: a player signed in with Google. The session routes use the plain
// axiosInstance; everything else goes through playerAxios, which sends
// `Authorization: Player <access token>` and renews it with the refresh token
// (once per expiry, shared by every request waiting on it).
import axios from "axios";

import axiosInstance, { generateIdempotencyKey } from "../axios";
import { usePlayerStore } from "../../../store/playerStore";

/** Where the browser goes to sign in; Google brings it back to /signed-in → returnPath. */
export const playerSignInUrl = (returnPath) =>
  `/api/v1/auth/google/start?return=${encodeURIComponent(returnPath)}`;

// Trade the sign-in page's single-use code → { accessToken: { token }, refreshToken: { token } }
export const startPlayerSessionApi = async (code) => {
  const response = await axiosInstance.post("/api/v1/player/session", { code });
  return response.data;
};

// End this browser's session (the refresh token stops working)
export const logoutPlayerApi = async (refreshToken) => {
  const response = await axiosInstance.post("/api/v1/player/session/logout", { refreshToken });
  return response.data;
};

let refreshing = null;

/**
 * A fresh access token from the stored refresh token. A 401 means the session
 * is over (signed out elsewhere, blocked, or a copied token) → signed out here.
 * @returns {Promise<string>}
 */
export const refreshPlayerSession = () => {
  if (!refreshing) {
    const { refreshToken } = usePlayerStore.getState();
    const request = refreshToken
      ? axiosInstance.post("/api/v1/player/session/refresh", { refreshToken })
      : Promise.reject(new Error("Not signed in"));
    refreshing = request
      .then((response) => {
        const { accessToken, refreshToken: next } = response.data.data;
        usePlayerStore.getState().setSession({
          accessToken: accessToken.token,
          refreshToken: next.token,
        });
        return accessToken.token;
      })
      .catch((error) => {
        if (!refreshToken || error?.response?.status === 401) usePlayerStore.getState().clear();
        throw error;
      })
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
};

const playerAxios = axios.create({ headers: { "Content-Type": "application/json" } });

playerAxios.interceptors.request.use(async (config) => {
  const token = usePlayerStore.getState().accessToken || (await refreshPlayerSession());
  config.headers.Authorization = `Player ${token}`;
  if (config.method?.toLowerCase() === "post" && !config.headers["Idempotency-Key"]) {
    // Not crypto.randomUUID(): browsers only have it on https / localhost, and the
    // player pages are also opened over plain http on the LAN in development
    config.headers["Idempotency-Key"] = generateIdempotencyKey();
  }
  return config;
});

playerAxios.interceptors.response.use(undefined, async (error) => {
  const { config, response } = error;
  if (response?.status === 401 && response.data?.code === "TOKEN_EXPIRED" && !config._retried) {
    config._retried = true;
    usePlayerStore.getState().setAccessToken(null);
    const token = await refreshPlayerSession();
    config.headers.Authorization = `Player ${token}`;
    return playerAxios(config);
  }
  // Blocked, signed out elsewhere, or no session: this browser is signed out too
  if (response?.status === 401) usePlayerStore.getState().clear();
  return Promise.reject(error);
});

// The signed-in player → { player: { firstName, middleName, lastName, name, email, photoUrl,
// phone, profileComplete } } — until profileComplete, the names are Google's (to pre-fill)
export const getPlayerMeApi = async () => {
  const response = await playerAxios.get("/api/v1/player/me");
  return response.data;
};

// Save the profile (first sign-in, or later). body: { firstName, middleName?, lastName, phone }
export const updatePlayerProfileApi = async (body) => {
  const response = await playerAxios.patch("/api/v1/player/me", body);
  return response.data;
};

// The game log → { upcoming: [booking], past: [booking], pagination }
// booking: { bookingCode, venueName, courtName, startAt, endAt, status, paymentStatus, price,
//            bookingUrl, games: [{ startAt, endAt, status, gameUrl, driveUrl }] }
export const getPlayerGamesApi = async ({ page = 1, limit = 10 } = {}) => {
  const response = await playerAxios.get("/api/v1/player/games", { params: { page, limit } });
  return response.data;
};

// Book as the signed-in player. body: { date, slots: [{ courtKey, startTime }], phone?, payMethod }
// (CR-047: neighbouring hours on a court join into one booking; several are paid in one checkout)
// 201 { bookingCode, manageToken, manageUrl, checkoutUrl, bookings: [...], total } — the first
// booking's links; checkoutUrl pays everything
export const createPlayerBookingApi = async ({ bookingToken, body }) => {
  const response = await playerAxios.post(`/api/v1/public/book/${bookingToken}/bookings`, body);
  return response.data;
};

// ── PLAN-009 phase B: sport profile, follows, Book again ─────────────────────

// → { sports: [{ sport, skillLevel, duprId, duprRating, duprVerified }] }
export const getPlayerSportsApi = async () => {
  const response = await playerAxios.get("/api/v1/player/sports");
  return response.data;
};

// body: { sport, skillLevel?, duprId?, duprRating? } — omitted / "" = not said → { sports }
export const savePlayerSportApi = async (body) => {
  const response = await playerAxios.put("/api/v1/player/sports", body);
  return response.data;
};

// → { venues: [{ key, name, address, logoUrl, directionsUrl, amenities, bookingToken }] }
export const getPlayerFollowsApi = async () => {
  const response = await playerAxios.get("/api/v1/player/follows");
  return response.data;
};

// Follow / unfollow a venue by its public key → { following }
export const followVenueApi = async (venueKey) => {
  const response = await playerAxios.post(`/api/v1/player/follows/${venueKey}`);
  return response.data;
};
export const unfollowVenueApi = async (venueKey) => {
  const response = await playerAxios.delete(`/api/v1/player/follows/${venueKey}`);
  return response.data;
};

// Venues booked lately (Book again), same shape as follows → { venues }
export const getRecentVenuesApi = async () => {
  const response = await playerAxios.get("/api/v1/player/recent-venues");
  return response.data;
};

// ── PLAN-009 phase C: Open Play spots ────────────────────────────────────────

// Take a spot → { signupCode, status: "Confirmed"|"Pending", checkoutUrl } (pay at checkoutUrl)
export const joinOpenPlayApi = async (playToken) => {
  const response = await playerAxios.post(`/api/v1/player/play/sessions/${playToken}/join`);
  return response.data;
};

// My spots → { spots: [{ signupCode, status, paymentStatus, price, holdExpiresAt, cancelBy,
//   session: { key, title, startAt, endAt, state, venueName, courts } }] }
export const getMyPlaySpotsApi = async (when = "upcoming") => {
  const response = await playerAxios.get("/api/v1/player/play/signups", { params: { when } });
  return response.data;
};

// The spot's checkout (again) → { paid, checkoutUrl }
export const payPlaySpotApi = async (signupCode) => {
  const response = await playerAxios.post(`/api/v1/player/play/signups/${signupCode}/pay`);
  return response.data;
};

// Give the spot up → { refunded, refundFailed } (pesos)
export const cancelPlaySpotApi = async (signupCode) => {
  const response = await playerAxios.post(`/api/v1/player/play/signups/${signupCode}/cancel`);
  return response.data;
};

// PLAN-009 phase D: my place in the session's queue →
// { queue: { state: "waiting"|"next"|"playing"|"resting"|"notCheckedIn"|"out", place?, court?,
//   partners?, opponents?, gamesAhead?, waiting, gamesPlayed, session, paused } }
export const getMyPlayQueueApi = async (signupCode) => {
  const response = await playerAxios.get(`/api/v1/player/play/signups/${signupCode}/queue`);
  return response.data;
};

// ── PLAN-009 phase E: tournaments ────────────────────────────────────────────

// Register a team (the caller is captain) → { teamCode, status, inviteUrl, checkoutUrl }
export const registerTeamApi = async ({ tournamentKey, divisionKey, name }) => {
  const response = await playerAxios.post(
    `/api/v1/player/tournaments/${tournamentKey}/divisions/${divisionKey}/register`,
    name ? { name } : {},
  );
  return response.data;
};

// Join a team as its partner → { registered }
export const joinTeamApi = async (inviteToken) => {
  const response = await playerAxios.post(`/api/v1/player/tournaments/invites/${inviteToken}/join`, {});
  return response.data;
};

// My teams → { teams: [{ teamCode, name, status, paymentStatus, captain, inviteUrl, canWithdraw, tournament, matches }] }
export const getMyTeamsApi = async () => (await playerAxios.get("/api/v1/player/tournaments/mine")).data;

// The entry's checkout (again), captain only → { paid, checkoutUrl }
export const payTeamApi = async (teamCode) => (await playerAxios.post(`/api/v1/player/tournaments/teams/${teamCode}/pay`, {})).data;

// Withdraw before the draw, captain only → { refunded, refundFailed }
export const withdrawTeamApi = async (teamCode) =>
  (await playerAxios.post(`/api/v1/player/tournaments/teams/${teamCode}/withdraw`, {})).data;

// ── PLAN-009 phase F: clubs ──────────────────────────────────────────────────

// → { clubs: [{ key, name, venueName, members, status: "Active"|"Pending", admin }] }
export const getMyClubsApi = async () => (await playerAxios.get("/api/v1/player/clubs")).data;
// → { status: "Active"|"Pending" }
export const joinClubApi = async (key) => (await playerAxios.post(`/api/v1/player/clubs/${key}/join`, {})).data;
export const leaveClubApi = async (key) => (await playerAxios.post(`/api/v1/player/clubs/${key}/leave`, {})).data;
