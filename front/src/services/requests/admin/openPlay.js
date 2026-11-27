import { toast } from "sonner";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addWalkInApi,
  cancelPlaySessionApi,
  cancelSpotApi,
  checkInSpotApi,
  createPlaySessionApi,
  endPlayGameApi,
  fillQueueApi,
  getPlayQueueApi,
  lineUpGameApi,
  pauseQueueApi,
  restSpotApi,
  swapPlayGameApi,
  voidPlayGameApi,
  getOpenPlayOptionsApi,
  getPlaySeriesApi,
  getPlaySessionApi,
  getPlaySessionsApi,
  stopPlaySeriesApi,
  updatePlaySessionApi,
} from "../../api/admin/openPlay";

// PLAN-009 phase C. Keys: ["openPlay", "options"] · ["openPlay", "sessions", filters] ·
// ["openPlay", "session", id] · ["openPlay", "series", venueId]. Every write refreshes ["openPlay"].

const errorText = (error, fallback) => error?.response?.data?.message || fallback;

const useOpenPlayMutation = (mutationFn, success, failure) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (response) => {
      toast.success(response?.message || success);
      queryClient.invalidateQueries({ queryKey: ["openPlay"] });
    },
    onError: (error) => toast.error(errorText(error, failure)),
  });
};

export const useGetOpenPlayOptions = () =>
  useQuery({ queryKey: ["openPlay", "options"], queryFn: getOpenPlayOptionsApi, staleTime: 5 * 60 * 1000 });

export const useGetPlaySessions = (filters = {}) =>
  useQuery({
    queryKey: ["openPlay", "sessions", filters],
    queryFn: () => getPlaySessionsApi(filters),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  });

export const useGetPlaySession = (playSessionId) =>
  useQuery({
    queryKey: ["openPlay", "session", playSessionId],
    queryFn: () => getPlaySessionApi(playSessionId),
    enabled: !!playSessionId,
    staleTime: 15 * 1000,
  });

export const useGetPlaySeries = (venueId) =>
  useQuery({
    queryKey: ["openPlay", "series", venueId || "all"],
    queryFn: () => getPlaySeriesApi(venueId),
    staleTime: 60 * 1000,
  });

export const useCreatePlaySession = () =>
  useOpenPlayMutation(createPlaySessionApi, "Session added", "Couldn't add the session");
export const useUpdatePlaySession = () =>
  useOpenPlayMutation(updatePlaySessionApi, "Session updated", "Couldn't update the session");
export const useCancelPlaySession = () =>
  useOpenPlayMutation(cancelPlaySessionApi, "Session cancelled", "Couldn't cancel the session");
export const useAddWalkIn = () => useOpenPlayMutation(addWalkInApi, "Walk-in added", "Couldn't add the walk-in");
export const useCheckInSpot = () => useOpenPlayMutation(checkInSpotApi, "Checked in", "Couldn't check them in");
export const useCancelSpot = () => useOpenPlayMutation(cancelSpotApi, "Spot cancelled", "Couldn't cancel the spot");
export const useStopPlaySeries = () => useOpenPlayMutation(stopPlaySeriesApi, "Series stopped", "Couldn't stop the series");

// ── PLAN-009 phase D: the queue ──────────────────────────────────────────────
// ["openPlay", "queue", id] — polled every 10 s (other tablets); every action answers with
// the new queue, which replaces the cached one at once.

export const useGetPlayQueue = (playSessionId) =>
  useQuery({
    queryKey: ["openPlay", "queue", playSessionId],
    queryFn: () => getPlayQueueApi(playSessionId),
    enabled: !!playSessionId,
    refetchInterval: 10 * 1000,
    staleTime: 5 * 1000,
  });

const useQueueMutation = (mutationFn, failure) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (response, variables) => {
      if (variables?.playSessionId && response?.data?.queue) {
        queryClient.setQueryData(["openPlay", "queue", variables.playSessionId], response);
      }
      queryClient.invalidateQueries({ queryKey: ["openPlay"] });
    },
    onError: (error) => toast.error(errorText(error, failure)),
  });
};

export const useFillQueue = () => useQueueMutation(fillQueueApi, "Couldn't fill the courts");
export const useLineUpGame = () => useQueueMutation(lineUpGameApi, "Couldn't line up a game");
export const usePauseQueue = () => useQueueMutation(pauseQueueApi, "Couldn't change the queue");
export const useEndPlayGame = () => useQueueMutation(endPlayGameApi, "Couldn't end the game");
export const useVoidPlayGame = () => useQueueMutation(voidPlayGameApi, "Couldn't call the game off");
export const useSwapPlayGame = () => useQueueMutation(swapPlayGameApi, "Couldn't swap the player");
export const useRestSpot = () => useQueueMutation(restSpotApi, "Couldn't change that player");
