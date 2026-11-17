import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getPairingCodesApi,
  createPairingCodeApi,
  cancelPairingCodeApi,
} from "../../api/admin/pairing-codes";

/** Recorder box pairing keys. Session device keys: requests/admin/sessions.js. */

// Query: keys still waiting to be used (no digits)
export const useGetPairingCodes = (options = {}) => {
  return useQuery({
    queryKey: ["pairingCodes", "recorders"],
    queryFn: getPairingCodesApi,
    staleTime: 15 * 1000,
    ...options,
  });
};

// Mutation: create a key — the response carries the 6 digits, shown once
export const useCreatePairingCode = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createPairingCodeApi,
    onSuccess: () => {
      toast.success("Pairing key created — it works once, for 10 minutes");
      queryClient.invalidateQueries({ queryKey: ["pairingCodes", "recorders"] });
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || "Failed to create a pairing key");
    },
  });
};

// Mutation: cancel a key nobody has used yet
export const useCancelPairingCode = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: cancelPairingCodeApi,
    onSuccess: () => {
      toast.success("Pairing key cancelled");
      queryClient.invalidateQueries({ queryKey: ["pairingCodes", "recorders"] });
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || "Failed to cancel the key");
      queryClient.invalidateQueries({ queryKey: ["pairingCodes", "recorders"] });
    },
  });
};
