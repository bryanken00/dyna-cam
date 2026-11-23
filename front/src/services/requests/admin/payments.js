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
  getSettlementApi,
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

// Query: the clip (or CR-015 game) behind a pay code, so staff can check it
// before taking cash: { kind: "Clip", clip } | { kind: "Game", game }.
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

// Mutation: Record a cash payment — the clip unlocks (CR-015: or the game's
// videos open, for { sessionId, amount })
export const useCreatePayment = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createPaymentApi,
    onSuccess: (response) => {
      toast.success(response?.message || "Payment recorded");
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      queryClient.invalidateQueries({ queryKey: ["clips"] });
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (error) => {
      const status = error.response?.status;
      toast.error(
        status === 404
          ? "No clip or game has that pay code"
          : error.response?.data?.message || "Failed to record the payment",
      );
      // 409 = already paid / free / expired — show the real state
      if (status === 409) {
        queryClient.invalidateQueries({ queryKey: ["payments"] });
        queryClient.invalidateQueries({ queryKey: ["clips"] });
        queryClient.invalidateQueries({ queryKey: ["sessions"] });
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

// Mutation: CR-015 — record what the player paid for a game; its videos open
// on the courtside device and the player's page
export const useRecordGamePayment = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ sessionId, amount, note }) =>
      createPaymentApi({ sessionId, amount, note: note || undefined }),
    onSuccess: () => {
      toast.success("Payment recorded — the game's videos are open");
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      queryClient.invalidateQueries({ queryKey: ["payments"] });
    },
    onError: (error) => {
      toast.error(
        error.response?.data?.message || "Failed to record the payment",
      );
      // 409 = already paid / cancelled — show the real state
      if (error.response?.status === 409) {
        queryClient.invalidateQueries({ queryKey: ["sessions"] });
      }
    },
  });
};

// Query: PLAN-003 Phase F — the online settlement statement for a date range
export const useGetSettlement = ({ dateFrom, dateTo }, options = {}) => {
  return useQuery({
    queryKey: ["payments", "settlement", dateFrom, dateTo],
    queryFn: () => getSettlementApi({ dateFrom, dateTo }),
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
    ...options,
  });
};
