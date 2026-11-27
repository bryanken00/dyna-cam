import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getOpenPlaySessionApi, getOpenPlaySessionsApi } from "../../api/public/openPlay";
import {
  cancelPlaySpotApi,
  getMyPlayQueueApi,
  getMyPlaySpotsApi,
  joinOpenPlayApi,
  payPlaySpotApi,
} from "../../api/public/player";
import { usePlayerSignedIn } from "../../../store/playerStore";

// PLAN-009 phase C. Keys: ["openPlay", "list", from, days] · ["openPlay", "session", key] ·
// ["player", "playSpots", when]. Joining, paying or cancelling refreshes the session and my spots.

const retryUnless401 = (count, error) => error?.response?.status !== 401 && count < 2;

export const useGetOpenPlaySessions = ({ from, days = 7, kind }) =>
  useQuery({
    queryKey: ["openPlay", "list", from, days, kind || "all"],
    queryFn: () => getOpenPlaySessionsApi({ from, days, kind }),
    staleTime: 30 * 1000,
  });

export const useGetOpenPlaySession = (playToken) =>
  useQuery({
    queryKey: ["openPlay", "session", playToken],
    queryFn: () => getOpenPlaySessionApi(playToken),
    enabled: !!playToken,
    staleTime: 15 * 1000,
    retry: (count, error) => error?.response?.status !== 404 && count < 2,
  });

export const useGetMyPlaySpots = (when = "upcoming") => {
  const signedIn = usePlayerSignedIn();
  return useQuery({
    queryKey: ["player", "playSpots", when],
    queryFn: () => getMyPlaySpotsApi(when),
    enabled: signedIn,
    staleTime: 15 * 1000,
    retry: retryUnless401,
  });
};

const useSpotMutation = (mutationFn) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["openPlay"] });
      queryClient.invalidateQueries({ queryKey: ["player", "playSpots"] });
    },
  });
};

// The page shows errors itself, so no toasts here
export const useJoinOpenPlay = () => useSpotMutation(joinOpenPlayApi);
export const usePayPlaySpot = () => useSpotMutation(payPlaySpotApi);
export const useCancelPlaySpot = () => useSpotMutation(cancelPlaySpotApi);

// PLAN-009 phase D: my place in line while the session runs — checked every 10 s
export const useGetMyPlayQueue = (signupCode, enabled) =>
  useQuery({
    queryKey: ["player", "playQueue", signupCode],
    queryFn: () => getMyPlayQueueApi(signupCode),
    enabled: !!signupCode && enabled,
    refetchInterval: 10 * 1000,
    retry: retryUnless401,
  });
