import { toast } from "sonner";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  getPairedAppsApi,
  getPairedAppOptionsApi,
  updatePairedAppApi,
  revokePairedAppApi,
  deletePairedAppApi,
} from "../../api/admin/paired-apps";

// Query: paired phones. `options` lets the page poll while a key is showing.
export const useGetPairedApps = (filters = {}, options = {}) => {
  return useQuery({
    queryKey: ["pairedApps", filters],
    queryFn: () => getPairedAppsApi(filters),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
    ...options,
  });
};

// Query: venues for the picker and filter
export const useGetPairedAppOptions = (options = {}) => {
  return useQuery({
    queryKey: ["pairedApps", "options"],
    queryFn: getPairedAppOptionsApi,
    staleTime: 5 * 60 * 1000,
    ...options,
  });
};

// Mutation: rename a phone
export const useUpdatePairedApp = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ pairedAppId, data }) => updatePairedAppApi(pairedAppId, data),
    onSuccess: () => {
      toast.success("Phone renamed");
      queryClient.invalidateQueries({ queryKey: ["pairedApps"] });
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || "Failed to rename the phone");
    },
  });
};

// Mutation: unpair (revoke) a phone
export const useRevokePairedApp = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: revokePairedAppApi,
    onSuccess: () => {
      toast.success("Phone unpaired");
      queryClient.invalidateQueries({ queryKey: ["pairedApps"] });
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || "Failed to unpair the phone");
    },
  });
};

// Mutation: delete a phone
export const useDeletePairedApp = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deletePairedAppApi,
    onSuccess: () => {
      toast.success("Phone deleted");
      queryClient.invalidateQueries({ queryKey: ["pairedApps"] });
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || "Failed to delete the phone");
    },
  });
};
