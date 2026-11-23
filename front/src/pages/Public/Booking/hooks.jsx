import { useCallback, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";

import { copyText } from "../../../utils/clipboard";
import { decodeHTML } from "../../../utils/decode-html";
import {
  useCheckInBooking,
  useGetMyBooking,
  usePayBookingOnline,
} from "../../../services/requests/public/bookings";

/** A failed check-in or Pay → the sentence under the button. */
const actionErrorMessage = (error) => {
  const apiMessage = error?.response?.data?.message;
  if (!error?.response) return "Couldn't reach Dyna Cam — check your connection and try again.";
  return apiMessage || "Something went wrong. Please try again.";
};

/**
 * `/booking/:manageToken` (PLAN-003): the player's own booking — its code,
 * where and when, what's owed and by when; during its time, Check in starts
 * the recorded game (Phase D). Phase F: Pay now opens Xendit's checkout; back
 * from it (?checkout=done) the page polls until the payment lands — only the
 * webhook (or the API asking Xendit) confirms it, never the redirect. Cancel
 * and move come in Phase H (the API's `actions` says which are on).
 */
export const useBookingPageHooks = () => {
  const { manageToken } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, error, refetch, isFetching } = useGetMyBooking(manageToken);
  const booking = data?.data?.booking || null;

  const checkInMutation = useCheckInBooking();
  const [checkInError, setCheckInError] = useState("");

  const [searchParams] = useSearchParams();
  const backFromCheckout = searchParams.get("checkout") === "done";
  const payMutation = usePayBookingOnline();
  const [payError, setPayError] = useState("");
  const [isRedirecting, setIsRedirecting] = useState(false);

  const handlePay = useCallback(() => {
    setPayError("");
    payMutation.mutate(manageToken, {
      onSuccess: (response) => {
        const checkoutUrl = response?.data?.checkoutUrl;
        if (response?.data?.paid || !checkoutUrl) {
          toast.success(response?.message || "Payment received");
          refetch();
          return;
        }
        setIsRedirecting(true);
        window.location.assign(checkoutUrl);
      },
      onError: (err) => {
        setPayError(actionErrorMessage(err));
        refetch();
      },
    });
  }, [payMutation, manageToken, refetch]);

  const handleCopyCode = useCallback(async () => {
    if (!booking) return;
    const ok = await copyText(booking.bookingCode);
    if (ok) toast.success("Booking code copied");
    else toast.error("Couldn't copy the code");
  }, [booking]);

  const handleCopyLink = useCallback(async () => {
    const ok = await copyText(window.location.href);
    if (ok) toast.success("Link copied — keep it to come back to your booking");
    else toast.error("Couldn't copy the link");
  }, []);

  const handleCheckIn = useCallback(() => {
    setCheckInError("");
    checkInMutation.mutate(manageToken, {
      onSuccess: (response) => {
        const shareToken = response?.data?.shareToken;
        if (shareToken) navigate(`/session/${shareToken}`);
      },
      onError: (err) => {
        setCheckInError(actionErrorMessage(err));
        refetch();
      },
    });
  }, [checkInMutation, manageToken, navigate, refetch]);

  return {
    booking,
    venueName: decodeHTML(booking?.venue?.name),
    courtName: decodeHTML(booking?.courtName),
    isLoading,
    isFetching,
    notFound: error?.response?.status === 404 || error?.response?.status === 400,
    loadError: error && ![400, 404].includes(error.response?.status) ? error : null,
    refetch,
    handleCopyCode,
    handleCopyLink,
    handleCheckIn,
    isCheckingIn: checkInMutation.isPending,
    checkInError,
    // Waiting for an online payment to land (back from the checkout)
    awaitingPayment: backFromCheckout && booking?.status === "Pending" && !!booking?.checkoutOpen,
    handlePay,
    isPaying: payMutation.isPending || isRedirecting,
    payError,
  };
};
