import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  disconnectCompanyPaymentsApi,
  getCompanyPaymentsApi,
  saveCompanyPaymentsApi,
} from "../../api/admin/companyPayments";

// Query: is the company's Xendit connected → data.payment
export const useGetCompanyPayments = (options = {}) => {
  return useQuery({
    queryKey: ["companyPayments"],
    queryFn: getCompanyPaymentsApi,
    staleTime: 60 * 1000,
    ...options,
  });
};

// Mutation: connect / replace the company's Xendit keys (the drawer shows the error itself)
export const useSaveCompanyPayments = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveCompanyPaymentsApi,
    onSuccess: (response) => {
      toast.success(response?.message || "Xendit connected");
      queryClient.invalidateQueries({ queryKey: ["companyPayments"] });
    },
  });
};

// Mutation: disconnect — the company's venues stop taking online payment
export const useDisconnectCompanyPayments = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: disconnectCompanyPaymentsApi,
    onSuccess: (response) => {
      toast.success(response?.message || "Xendit disconnected");
      queryClient.invalidateQueries({ queryKey: ["companyPayments"] });
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || "Failed to disconnect Xendit");
    },
  });
};
