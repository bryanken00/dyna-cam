import { toast } from "sonner";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  getClipsApi,
  getClipOptionsApi,
  deleteClipApi,
} from "../../api/admin/clips";

// Query: Get all clips (filters: venueId, courtId, source, status, dateFrom, dateTo)
export const useGetClips = (filters = {}) => {
  return useQuery({
    queryKey: ["clips", filters],
    queryFn: () => getClipsApi(filters),
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
    // Pending clips turn Ready within a minute or two — keep the list moving
    refetchInterval: (query) =>
      query.state.data?.data?.clips?.some((c) =>
        ["Pending", "Processing"].includes(c.status),
      )
        ? 15 * 1000
        : false,
  });
};

// Query: venues + courts for the filters → { venues, courts }
export const useGetClipOptions = () => {
  return useQuery({
    queryKey: ["clips", "options"],
    queryFn: getClipOptionsApi,
    staleTime: 5 * 60 * 1000,
  });
};

// Mutation: Delete a clip (and its files)
export const useDeleteClip = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteClipApi,
    onSuccess: () => {
      toast.success("Clip deleted successfully");
      queryClient.invalidateQueries({ queryKey: ["clips"] });
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || "Failed to delete clip");
    },
  });
};
