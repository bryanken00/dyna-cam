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
  lookupPaymentApi,
  createPaymentApi,
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

// Query: the clip behind a pay code, so staff can check it before taking cash.
// Runs only once a code is submitted; a 404 is an answer, not a retry case.
export const useLookupPayCode = (payCode) => {
  return useQuery({
    queryKey: ["payments", "lookup", payCode],
    queryFn: () => lookupPaymentApi(payCode),
    enabled: !!payCode,
    retry: false,
    staleTime: 0,
    gcTime: 60 * 1000,
  });
};

// Mutation: Record a cash payment — the clip unlocks
export const useCreatePayment = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createPaymentApi,
    onSuccess: () => {
      toast.success("Payment recorded — the clip is unlocked");
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      queryClient.invalidateQueries({ queryKey: ["clips"] });
    },
    onError: (error) => {
      const status = error.response?.status;
      toast.error(
        status === 404
          ? "No clip has that pay code"
          : error.response?.data?.message || "Failed to record the payment",
      );
      // 409 = already paid / free / expired — show the real state
      if (status === 409) {
        queryClient.invalidateQueries({ queryKey: ["payments"] });
        queryClient.invalidateQueries({ queryKey: ["clips"] });
      }
    },
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
    },
    onError: (error) => {
      toast.error(
        error.response?.data?.message || "Failed to refund the payment",
      );
      queryClient.invalidateQueries({ queryKey: ["payments"] });
    },
  });
};
