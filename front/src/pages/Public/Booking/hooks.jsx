import { useCallback } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";

import { copyText } from "../../../utils/clipboard";
import { decodeHTML } from "../../../utils/decode-html";
import { useGetMyBooking } from "../../../services/requests/public/bookings";

/**
 * `/booking/:manageToken` (PLAN-003 Phase C): the player's own booking — its
 * code, where and when, what's owed and by when. Check in, pay online, cancel
 * and move come in later phases (the API's `actions` says which are on).
 */
export const useBookingPageHooks = () => {
  const { manageToken } = useParams();
  const { data, isLoading, error, refetch, isFetching } = useGetMyBooking(manageToken);
  const booking = data?.data?.booking || null;

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
  };
};
