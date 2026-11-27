import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getTeamInviteApi, getTournamentApi, getTournamentsApi } from "../../api/public/tournaments";
import { getMyTeamsApi, joinTeamApi, payTeamApi, registerTeamApi, withdrawTeamApi } from "../../api/public/player";
import { usePlayerSignedIn } from "../../../store/playerStore";

// PLAN-009 phase E. Keys: ["tournaments", "list"] · ["tournaments", "one", key] · ["tournaments", "invite", token] ·
// ["player", "teams"]. Every write refreshes the tournament and my teams.

const no404Retry = (count, error) => error?.response?.status !== 404 && count < 2;

export const useGetTournaments = () =>
  useQuery({ queryKey: ["tournaments", "list"], queryFn: getTournamentsApi, staleTime: 60 * 1000 });

export const useGetTournament = (key) =>
  useQuery({
    queryKey: ["tournaments", "one", key],
    queryFn: () => getTournamentApi(key),
    enabled: !!key,
    staleTime: 15 * 1000,
    // Live scores move — check again every 30 s
    refetchInterval: 30 * 1000,
    retry: no404Retry,
  });

export const useGetTeamInvite = (token) =>
  useQuery({
    queryKey: ["tournaments", "invite", token],
    queryFn: () => getTeamInviteApi(token),
    enabled: !!token,
    retry: no404Retry,
  });

export const useGetMyTeams = () => {
  const signedIn = usePlayerSignedIn();
  return useQuery({
    queryKey: ["player", "teams"],
    queryFn: getMyTeamsApi,
    enabled: signedIn,
    staleTime: 15 * 1000,
    retry: (count, error) => error?.response?.status !== 401 && count < 2,
  });
};

const useTeamMutation = (mutationFn) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["tournaments"] });
      queryClient.invalidateQueries({ queryKey: ["player", "teams"] });
    },
  });
};

// The page shows errors itself
export const useRegisterTeam = () => useTeamMutation(registerTeamApi);
export const useJoinTeam = () => useTeamMutation(joinTeamApi);
export const usePayTeam = () => useTeamMutation(payTeamApi);
export const useWithdrawTeam = () => useTeamMutation(withdrawTeamApi);
