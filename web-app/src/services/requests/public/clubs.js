import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getClubApi, getClubsApi } from "../../api/public/clubs";
import { getMyClubsApi, joinClubApi, leaveClubApi } from "../../api/public/player";
import { usePlayerSignedIn } from "../../../store/playerStore";

// PLAN-009 phase F. Keys: ["clubs", "list"] · ["clubs", "one", key] · ["player", "clubs"].

export const useGetClubs = () => useQuery({ queryKey: ["clubs", "list"], queryFn: getClubsApi, staleTime: 60 * 1000 });

export const useGetClub = (key) =>
  useQuery({
    queryKey: ["clubs", "one", key],
    queryFn: () => getClubApi(key),
    enabled: !!key,
    staleTime: 30 * 1000,
    retry: (count, error) => error?.response?.status !== 404 && count < 2,
  });

export const useGetMyClubs = () => {
  const signedIn = usePlayerSignedIn();
  return useQuery({
    queryKey: ["player", "clubs"],
    queryFn: getMyClubsApi,
    enabled: signedIn,
    staleTime: 30 * 1000,
    retry: (count, error) => error?.response?.status !== 401 && count < 2,
  });
};

const useClubMutation = (mutationFn) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["clubs"] });
      queryClient.invalidateQueries({ queryKey: ["player", "clubs"] });
    },
  });
};

export const useJoinClub = () => useClubMutation(joinClubApi);
export const useLeaveClub = () => useClubMutation(leaveClubApi);
