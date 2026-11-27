import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createPlayerBookingApi,
  followVenueApi,
  getPlayerFollowsApi,
  getPlayerSportsApi,
  getRecentVenuesApi,
  savePlayerSportApi,
  unfollowVenueApi,
  getPlayerGamesApi,
  getPlayerMeApi,
  logoutPlayerApi,
  startPlayerSessionApi,
  updatePlayerProfileApi,
} from "../../api/public/player";
import { usePlayerSignedIn, usePlayerStore } from "../../../store/playerStore";

// A refused session (401) isn't worth retrying — the interceptor signed the player out
const retryUnless401 = (count, error) => error?.response?.status !== 401 && count < 2;

// Query: the signed-in player (name, email, photo, last phone)
export const useGetPlayerMe = () => {
  const signedIn = usePlayerSignedIn();
  return useQuery({
    queryKey: ["player", "me"],
    queryFn: getPlayerMeApi,
    enabled: signedIn,
    staleTime: 5 * 60 * 1000,
    retry: retryUnless401,
  });
};

// Query: the game log, one page of past bookings at a time
export const useGetPlayerGames = (page) => {
  const signedIn = usePlayerSignedIn();
  return useQuery({
    queryKey: ["player", "games", page],
    queryFn: () => getPlayerGamesApi({ page }),
    enabled: signedIn,
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
    retry: retryUnless401,
  });
};

// Mutation: trade the sign-in code for a session
export const useStartPlayerSession = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: startPlayerSessionApi,
    onSuccess: (response) => {
      const { accessToken, refreshToken } = response.data;
      usePlayerStore.getState().setSession({
        accessToken: accessToken.token,
        refreshToken: refreshToken.token,
      });
      queryClient.invalidateQueries({ queryKey: ["player"] });
    },
  });
};

// Mutation: sign out here. The session ends on this browser even if the API can't be reached.
export const useSignOutPlayer = () => {
  return useMutation({
    mutationFn: async () => {
      const { refreshToken } = usePlayerStore.getState();
      try {
        if (refreshToken) await logoutPlayerApi(refreshToken);
      } finally {
        usePlayerStore.getState().clear();
      }
    },
  });
};

// Mutation: save the profile — the cached player is replaced with the saved one
export const useUpdatePlayerProfile = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updatePlayerProfileApi,
    onSuccess: (response) => {
      queryClient.setQueryData(["player", "me"], response);
    },
  });
};

/**
 * Where a signed-in player must go first: their profile, until it's complete
 * (asked on the first sign-in). `null` when nothing's pending (or not known yet).
 * @param {string} next - where to come back to afterwards
 */
export const useProfileRedirect = (next) => {
  const { data } = useGetPlayerMe();
  const player = data?.data?.player;
  if (!player || player.profileComplete) return null;
  return `/me/profile?next=${encodeURIComponent(next)}`;
};

// Mutation: book as the signed-in player. The page shows errors itself, so no toast here.
export const useCreatePlayerBooking = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createPlayerBookingApi,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["player"] });
    },
  });
};

// ── PLAN-009 phase B ─────────────────────────────────────────────────────────

// Query: the player's sport profile (level, DUPR)
export const useGetPlayerSports = () => {
  const signedIn = usePlayerSignedIn();
  return useQuery({
    queryKey: ["player", "sports"],
    queryFn: getPlayerSportsApi,
    enabled: signedIn,
    staleTime: 5 * 60 * 1000,
    retry: retryUnless401,
  });
};

// Mutation: save one sport's answers — the cache takes the saved list
export const useSavePlayerSport = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: savePlayerSportApi,
    onSuccess: (response) => {
      queryClient.setQueryData(["player", "sports"], response);
    },
  });
};

// Query: the venues the player follows
export const useGetPlayerFollows = () => {
  const signedIn = usePlayerSignedIn();
  return useQuery({
    queryKey: ["player", "follows"],
    queryFn: getPlayerFollowsApi,
    enabled: signedIn,
    staleTime: 60 * 1000,
    retry: retryUnless401,
  });
};

// Mutation: follow (`on`) or unfollow a venue → the follow list and the venue list's counts refresh
export const useToggleFollow = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ venueKey, on }) => (on ? followVenueApi(venueKey) : unfollowVenueApi(venueKey)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["player", "follows"] });
      queryClient.invalidateQueries({ queryKey: ["publicVenues"] });
    },
  });
};

// Query: venues booked lately (Book again)
export const useGetRecentVenues = () => {
  const signedIn = usePlayerSignedIn();
  return useQuery({
    queryKey: ["player", "recent-venues"],
    queryFn: getRecentVenuesApi,
    enabled: signedIn,
    staleTime: 60 * 1000,
    retry: retryUnless401,
  });
};
