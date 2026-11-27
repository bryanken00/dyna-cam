import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createClubApi,
  deleteClubApi,
  getClubApi,
  getClubOptionsApi,
  getClubsApi,
  updateClubApi,
  updateClubMemberApi,
} from "../../api/admin/clubs";

// PLAN-009 phase F. Keys: ["clubs", "list", filters] · ["clubs", "one", id]. Writes refresh ["clubs"]
// (and Open Play's options, which list each venue's clubs).

const useClubMutation = (mutationFn, failure) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (response) => {
      toast.success(response?.message || "Saved");
      queryClient.invalidateQueries({ queryKey: ["clubs"] });
      queryClient.invalidateQueries({ queryKey: ["openPlay", "options"] });
    },
    onError: (error) => toast.error(error?.response?.data?.message || failure),
  });
};

export const useGetClubs = (filters = {}) =>
  useQuery({ queryKey: ["clubs", "list", filters], queryFn: () => getClubsApi(filters), staleTime: 30 * 1000 });
export const useGetClub = (clubId) =>
  useQuery({ queryKey: ["clubs", "one", clubId], queryFn: () => getClubApi(clubId), enabled: !!clubId, staleTime: 15 * 1000 });
export const useCreateClub = () => useClubMutation(createClubApi, "Couldn't add the club");
export const useUpdateClub = () => useClubMutation(updateClubApi, "Couldn't save the club");
export const useDeleteClub = () => useClubMutation(deleteClubApi, "Couldn't remove the club");
export const useUpdateClubMember = () => useClubMutation(updateClubMemberApi, "Couldn't change that member");

export const useGetClubOptions = () =>
  useQuery({ queryKey: ["clubs", "options"], queryFn: getClubOptionsApi, staleTime: 5 * 60 * 1000 });
