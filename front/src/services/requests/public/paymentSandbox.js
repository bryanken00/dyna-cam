import { useMutation, useQuery } from "@tanstack/react-query";
import { getSandboxCheckoutApi, paySandboxCheckoutApi } from "../../api/public/paymentSandbox";

// Query: CR-033 — the test checkout. A 404 means it doesn't exist (or the
// sandbox is off) — don't retry it.
export const useGetSandboxCheckout = (checkoutId) => {
  return useQuery({
    queryKey: ["sandboxCheckout", checkoutId],
    queryFn: () => getSandboxCheckoutApi(checkoutId),
    enabled: !!checkoutId,
    retry: (count, error) => error?.response?.status !== 404 && count < 2,
  });
};

// Mutation: CR-033 — pay the test checkout. The page sends the player back to
// returnUrl and shows errors itself.
export const usePaySandboxCheckout = () => {
  return useMutation({ mutationFn: paySandboxCheckoutApi });
};
