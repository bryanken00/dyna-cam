import { useCallback, useState } from "react";
import { useParams } from "react-router";

import {
  useGetSandboxCheckout,
  usePaySandboxCheckout,
} from "../../../services/requests/public/paymentSandbox";

/** A failed Pay → the sentence under the buttons. */
const payErrorMessage = (error) => {
  const apiMessage = error?.response?.data?.message;
  if (!error?.response) return "Couldn't reach DGSports — check your connection and try again.";
  return apiMessage || "Something went wrong. Please try again.";
};

/**
 * `/payment-sandbox/:checkoutId` (CR-033): the built-in test checkout that
 * stands in for Xendit's while the API runs with PAYMENT_SANDBOX=true. Pay →
 * back to the booking's page, which turns Paid; Go back leaves it unpaid.
 */
export const usePaymentSandboxPageHooks = () => {
  const { checkoutId } = useParams();
  const { data: apiData, isLoading, isFetching, error, refetch } = useGetSandboxCheckout(checkoutId);
  const payMutation = usePaySandboxCheckout();
  const [payError, setPayError] = useState("");

  const checkout = apiData?.data?.checkout || null;
  const notFound = error?.response?.status === 404 || error?.response?.status === 400;

  const goBack = useCallback(() => {
    if (checkout?.returnUrl) window.location.assign(checkout.returnUrl);
  }, [checkout]);

  const handlePay = useCallback(() => {
    setPayError("");
    payMutation.mutate(checkoutId, {
      onSuccess: (response) => {
        const returnUrl = response?.data?.returnUrl || checkout?.returnUrl;
        if (returnUrl) window.location.assign(returnUrl);
      },
      onError: (err) => {
        setPayError(payErrorMessage(err));
        refetch();
      },
    });
  }, [payMutation, checkoutId, checkout, refetch]);

  return {
    checkout,
    isLoading,
    isFetching,
    notFound,
    loadError: !!error && !notFound,
    refetch,
    handlePay,
    isPaying: payMutation.isPending || payMutation.isSuccess,
    payError,
    goBack,
  };
};
