import { useCallback, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import dayjs from "dayjs";

import { confirm } from "../../../store/confirmStore";
import { copyText } from "../../../utils/clipboard";
import { formatPeso } from "../../../utils/dynaCam";
import { decodeHTML } from "../../../utils/decode-html";
import {
  useCancelMyBooking,
  useCheckInBooking,
  useGetMoveOptions,
  useGetMyBooking,
  useMoveMyBooking,
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
 * webhook (or the API asking Xendit) confirms it, never the redirect. Phase H:
 * Cancel (full refund of an online payment) and Move (once, to a time at the
 * same price or less) until the venue's cut-off — the API's `actions` says
 * which are on.
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

  // ─── Phase H: cancel ───────────────────────────────────────────────
  const cancelMutation = useCancelMyBooking();
  const [changeError, setChangeError] = useState("");

  const handleCancel = useCallback(async () => {
    if (!booking) return;
    setChangeError("");
    const paidOnline = booking.paymentStatus === "Paid" && booking.payMethod === "Online";
    const ok = await confirm({
      title: "Cancel this booking?",
      description: paidOnline
        ? `The court is released and your ${formatPeso(booking.price)} is refunded in full to the account you paid with.`
        : "The court is released for others to book. This can't be undone.",
      confirmText: "Cancel booking",
      cancelText: "Keep it",
      danger: true,
    });
    if (!ok) return;
    cancelMutation.mutate(manageToken, {
      onSuccess: (response) => toast.success(response?.message || "Booking cancelled"),
      onError: (err) => {
        setChangeError(actionErrorMessage(err));
        refetch();
      },
    });
  }, [booking, cancelMutation, manageToken, refetch]);

  // ─── Phase H: move ─────────────────────────────────────────────────
  const [moveOpen, setMoveOpen] = useState(false);
  const [pickedMoveDate, setPickedMoveDate] = useState(null);
  const [moveSlot, setMoveSlot] = useState(null); // { courtKey, startTime }
  const moveMutation = useMoveMyBooking();

  // Start on the booking's own day
  const bookingDay = booking ? dayjs(booking.startAt).format("YYYY-MM-DD") : null;
  const moveDate = pickedMoveDate || bookingDay;
  const {
    data: moveData,
    isLoading: moveLoading,
    error: moveError,
  } = useGetMoveOptions({ manageToken, date: moveDate }, { enabled: moveOpen });
  const moveOptions = moveData?.data || null;

  const moveDates = useMemo(() => {
    if (!moveOptions) return [];
    const open = new Set(moveOptions.openDays);
    const list = [];
    let d = dayjs(moveOptions.today);
    const last = dayjs(moveOptions.lastDate);
    while (!d.isAfter(last, "day")) {
      list.push({ date: d.format("YYYY-MM-DD"), open: open.has(d.day()), day: d });
      d = d.add(1, "day");
    }
    return list;
  }, [moveOptions]);

  // The picked new time: court and times (the booking keeps its own price)
  const movePicked = useMemo(() => {
    if (!moveSlot || !moveOptions) return null;
    const court = moveOptions.courts.find((c) => c.key === moveSlot.courtKey);
    const slotInfo = court?.slots.find((x) => x.startTime === moveSlot.startTime);
    if (!court || !slotInfo?.available) return null;
    const start = dayjs(`${moveDate} ${moveSlot.startTime}`);
    return { courtName: decodeHTML(court.name), start, end: start.add(moveOptions.durationMinutes, "minute") };
  }, [moveSlot, moveOptions, moveDate]);

  const handleOpenMove = useCallback(() => {
    setChangeError("");
    setMoveSlot(null);
    setPickedMoveDate(null);
    setMoveOpen(true);
  }, []);
  const handleCloseMove = useCallback(() => setMoveOpen(false), []);
  const handlePickMoveDate = useCallback((value) => {
    setPickedMoveDate(value);
    setMoveSlot(null);
  }, []);
  const handlePickMoveSlot = useCallback((courtKey, startTime) => {
    setMoveSlot({ courtKey, startTime });
    setChangeError("");
  }, []);

  const handleMove = useCallback(() => {
    if (!moveSlot) return;
    setChangeError("");
    moveMutation.mutate(
      { manageToken, body: { courtKey: moveSlot.courtKey, date: moveDate, startTime: moveSlot.startTime } },
      {
        onSuccess: () => {
          toast.success("Moved — we've emailed you the new time");
          setMoveOpen(false);
          setMoveSlot(null);
        },
        onError: (err) => {
          setChangeError(actionErrorMessage(err));
          setMoveSlot(null);
          refetch();
        },
      },
    );
  }, [moveSlot, moveMutation, manageToken, moveDate, refetch]);

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
    // Phase H
    handleCancel,
    isCancelling: cancelMutation.isPending,
    changeError,
    moveOpen,
    handleOpenMove,
    handleCloseMove,
    moveOptions,
    moveLoading,
    moveError,
    moveDates,
    moveDate,
    moveSlot,
    movePicked,
    handlePickMoveDate,
    handlePickMoveSlot,
    handleMove,
    isMoving: moveMutation.isPending,
  };
};
