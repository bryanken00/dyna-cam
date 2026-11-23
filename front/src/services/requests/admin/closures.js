import { toast } from "sonner";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createClosureApi,
  deleteClosureApi,
  getClosuresApi,
  updateClosureApi,
} from "../../api/admin/closures";

/**
 * A closure on live bookings answers 409 BOOKINGS_IN_THE_WAY with the list in
 * error.conflicts — the drawer shows them and asks, so no toast for it.
 */
export const bookingsInTheWay = (error) =>
  error?.response?.data?.code === "BOOKINGS_IN_THE_WAY"
    ? error.response.data.error?.conflicts || []
    : null;

const toastUnlessConflicts = (fallback) => (error) => {
  if (bookingsInTheWay(error)) return;
  toast.error(error.response?.data?.message || fallback);
};

// Query: a venue's closures → data.closures, data.pagination
export const useGetClosures = (filters = {}, options = {}) => {
  return useQuery({
    queryKey: ["closures", filters],
    queryFn: () => getClosuresApi(filters),
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
    ...options,
    enabled: !!filters.venueId && (options.enabled ?? true),
  });
};

// Mutation: add a closure
export const useCreateClosure = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createClosureApi,
    onSuccess: () => {
      toast.success("Closure added");
      queryClient.invalidateQueries({ queryKey: ["closures"] });
      // Bookings in the way may have been cancelled
      queryClient.invalidateQueries({ queryKey: ["bookings"] });
    },
    onError: toastUnlessConflicts("Failed to add the closure"),
  });
};

// Mutation: edit a closure
export const useUpdateClosure = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ closureId, closure }) => updateClosureApi(closureId, closure),
    onSuccess: () => {
      toast.success("Closure updated");
      queryClient.invalidateQueries({ queryKey: ["closures"] });
      queryClient.invalidateQueries({ queryKey: ["bookings"] });
    },
    onError: toastUnlessConflicts("Failed to update the closure"),
  });
};

// Mutation: remove a closure (soft delete)
export const useDeleteClosure = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteClosureApi,
    onSuccess: () => {
      toast.success("Closure removed");
      queryClient.invalidateQueries({ queryKey: ["closures"] });
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || "Failed to remove the closure");
    },
  });
};
