import { toast } from "sonner";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  getDevicesApi,
  getDeviceOptionsApi,
  updateDeviceApi,
  revokeDeviceApi,
  deleteDeviceApi,
} from "../../api/admin/devices";

// Query: Get all recorder boxes (filter ?venueId=). Online status comes from
// the box's heartbeat, so refresh it every 30 s while the page is open.
export const useGetDevices = (filters = {}, options = {}) => {
  return useQuery({
    queryKey: ["devices", filters],
    queryFn: () => getDevicesApi(filters),
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000,
    placeholderData: keepPreviousData,
    ...options,
  });
};

// Query: venue options for this page's picker and filter → { venues }
export const useGetDeviceOptions = (options = {}) => {
  return useQuery({
    queryKey: ["devices", "options"],
    queryFn: getDeviceOptionsApi,
    staleTime: 5 * 60 * 1000,
    ...options,
  });
};

// Mutation: Rename a box
export const useUpdateDevice = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ deviceId, deviceData }) =>
      updateDeviceApi(deviceId, deviceData),
    onSuccess: () => {
      toast.success("Recorder box updated successfully");
      queryClient.invalidateQueries({ queryKey: ["devices"] });
    },
    onError: (error) => {
      toast.error(
        error.response?.data?.message || "Failed to update recorder box",
      );
    },
  });
};

// Mutation: Revoke a box
export const useRevokeDevice = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: revokeDeviceApi,
    onSuccess: () => {
      toast.success("Recorder box revoked");
      queryClient.invalidateQueries({ queryKey: ["devices"] });
      queryClient.invalidateQueries({ queryKey: ["venues"] }); // deviceCount
    },
    onError: (error) => {
      toast.error(
        error.response?.data?.message || "Failed to revoke recorder box",
      );
    },
  });
};

// Mutation: Delete a box
export const useDeleteDevice = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteDeviceApi,
    onSuccess: () => {
      toast.success("Recorder box deleted successfully");
      queryClient.invalidateQueries({ queryKey: ["devices"] });
      queryClient.invalidateQueries({ queryKey: ["venues"] }); // deviceCount
    },
    onError: (error) => {
      toast.error(
        error.response?.data?.message || "Failed to delete recorder box",
      );
    },
  });
};
