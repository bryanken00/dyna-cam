import { toast } from "sonner";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  getPaymentOptionsApi,
  getPaymentsApi,
  refundPaymentApi,
} from "../../api/admin/payments";

// Query: Get payments (+ totals)
export const useGetPayments = (filters = {}) => {
  return useQuery({
    queryKey: ["payments", filters],
    queryFn: () => getPaymentsApi(filters),
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  });
};

// Query: venues for the Payments filter
export const useGetPaymentOptions = () => {
  return useQuery({
    queryKey: ["payments", "options"],
    queryFn: getPaymentOptionsApi,
    staleTime: 5 * 60 * 1000,
  });
};

// Mutation: Refund a payment — the clip locks again
export const useRefundPayment = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: refundPaymentApi,
    onSuccess: (response) => {
      toast.success(
        response?.message || "Payment refunded — the clip is locked again",
      );
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      queryClient.invalidateQueries({ queryKey: ["clips"] });
      queryClient.invalidateQueries({ queryKey: ["sessions"] }); // CR-015: a game locks again
    },
    onError: (error) => {
      toast.error(
        error.response?.data?.message || "Failed to refund the payment",
      );
      queryClient.invalidateQueries({ queryKey: ["payments"] });
    },
  });
};
