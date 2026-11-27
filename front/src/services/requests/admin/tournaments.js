import { toast } from "sonner";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "../../api/admin/tournaments";

// PLAN-009 phase E. Keys: ["tournaments", "options"] · ["tournaments", "list", filters] ·
// ["tournaments", "one", id]. Every write refreshes ["tournaments"].

const errorText = (error, fallback) => error?.response?.data?.message || fallback;

const useTournamentMutation = (mutationFn, failure, { silent = false } = {}) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (response) => {
      if (!silent) toast.success(response?.message || "Saved");
      queryClient.invalidateQueries({ queryKey: ["tournaments"] });
    },
    onError: (error) => toast.error(errorText(error, failure)),
  });
};

export const useGetTournamentOptions = () =>
  useQuery({ queryKey: ["tournaments", "options"], queryFn: api.getTournamentOptionsApi, staleTime: 5 * 60 * 1000 });

export const useGetTournaments = (filters = {}) =>
  useQuery({
    queryKey: ["tournaments", "list", filters],
    queryFn: () => api.getTournamentsApi(filters),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  });

export const useGetTournament = (tournamentId) =>
  useQuery({
    queryKey: ["tournaments", "one", tournamentId],
    queryFn: () => api.getTournamentApi(tournamentId),
    enabled: !!tournamentId,
    staleTime: 10 * 1000,
  });

export const useCreateTournament = () => useTournamentMutation(api.createTournamentApi, "Couldn't add the tournament");
export const useUpdateTournament = () => useTournamentMutation(api.updateTournamentApi, "Couldn't save the tournament");
export const useSetTournamentStatus = () => useTournamentMutation(api.setTournamentStatusApi, "Couldn't change the status");
export const useCancelTournament = () => useTournamentMutation(api.cancelTournamentApi, "Couldn't cancel the tournament");
export const useCreateDivision = () => useTournamentMutation(api.createDivisionApi, "Couldn't add the division");
export const useUpdateDivision = () => useTournamentMutation(api.updateDivisionApi, "Couldn't save the division");
export const useDeleteDivision = () => useTournamentMutation(api.deleteDivisionApi, "Couldn't remove the division");
export const useAddStaffTeam = () => useTournamentMutation(api.addStaffTeamApi, "Couldn't add the team");
export const useGenerateDraw = () => useTournamentMutation(api.generateDrawApi, "Couldn't generate the draw");
export const useSetTeamSeed = () => useTournamentMutation(api.setTeamSeedApi, "Couldn't save the seed", { silent: true });
export const useWithdrawTeam = () => useTournamentMutation(api.withdrawTeamApi, "Couldn't withdraw the team");
export const useScheduleMatch = () => useTournamentMutation(api.scheduleMatchApi, "Couldn't schedule the match", { silent: true });
export const useCallMatch = () => useTournamentMutation(api.callMatchApi, "Couldn't call the match");
export const useScoreMatch = () => useTournamentMutation(api.scoreMatchApi, "Couldn't save the score");
