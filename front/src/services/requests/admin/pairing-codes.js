import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getPairingCodesApi,
  createPairingCodeApi,
  cancelPairingCodeApi,
} from "../../api/admin/pairing-codes";

/** `kind`: "apps" (staff phones) or "recorders" (recorder boxes). */

// Query: keys still waiting to be used (no digits)
export const useGetPairingCodes = (kind, options = {}) => {
  return useQuery({
    queryKey: ["pairingCodes", kind],
    queryFn: () => getPairingCodesApi(kind),
    staleTime: 15 * 1000,
    ...options,
  });
};

// Mutation: create a key — the response carries the 6 digits, shown once
export const useCreatePairingCode = (kind) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => createPairingCodeApi(kind, data),
    onSuccess: () => {
      toast.success("Pairing key created — it works once, for 10 minutes");
      queryClient.invalidateQueries({ queryKey: ["pairingCodes", kind] });
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || "Failed to create a pairing key");
    },
  });
};

// Mutation: cancel a key nobody has used yet
export const useCancelPairingCode = (kind) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pairingCodeId) => cancelPairingCodeApi(kind, pairingCodeId),
    onSuccess: () => {
      toast.success("Pairing key cancelled");
      queryClient.invalidateQueries({ queryKey: ["pairingCodes", kind] });
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || "Failed to cancel the key");
      queryClient.invalidateQueries({ queryKey: ["pairingCodes", kind] });
    },
  });
};
