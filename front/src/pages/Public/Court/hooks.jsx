import { useCallback, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import dayjs from "dayjs";
import { z } from "zod";

import { decodeHTML } from "../../../utils/decode-html";
import { useCheckInAtCourt, useGetPublicCourt } from "../../../services/requests/public/courts";

// PLAN-003 Phase D: the booking code from the player's booking page
const checkInSchema = z.object({
  bookingCode: z
    .string()
    .trim()
    .min(4, "Enter the code from your booking")
    .max(20, "That code is too long"),
});

/** Turn a failed check-in into the sentence the player sees under the button. */
const checkInErrorMessage = (error) => {
  const status = error?.response?.status;
  const apiMessage = error?.response?.data?.message;
  if (status === 503 || status === 409 || status === 404) {
    return apiMessage || "This court can't start your game right now.";
  }
  if (status === 429) {
    return apiMessage || "Too many tries — wait a minute and try again.";
  }
  if (!error?.response) {
    return "Couldn't reach DGSports — check your connection and try again.";
  }
  return apiMessage || "Something went wrong. Please try again.";
};

/**
 * `/court/:qrToken` — the court's QR page. CR-034: the booking code is the only
 * way in (CR-027's walk-in Start game is gone); the code starts the booked
 * game and the player lands on its page.
 */
export const useCourtPageHooks = () => {
  const { qrToken } = useParams();
  const navigate = useNavigate();

  const { data, isLoading, error, refetch, isFetching } = useGetPublicCourt(qrToken);
  const checkInMutation = useCheckInAtCourt();
  const [checkInError, setCheckInError] = useState("");

  const checkInForm = useForm({
    resolver: zodResolver(checkInSchema),
    defaultValues: { bookingCode: "" },
    mode: "onTouched",
  });

  const court = data?.data?.court || null;
  const notFound = error?.response?.status === 404;

  const handleCheckIn = useCallback(
    ({ bookingCode }) => {
      setCheckInError("");
      checkInMutation.mutate(
        { qrToken, bookingCode },
        {
          onSuccess: (response) => {
            const shareToken = response?.data?.shareToken;
            if (!shareToken) {
              setCheckInError("Something went wrong. Please try again.");
              return;
            }
            // The game's page: live view, Save the last …, then the videos.
            // replace: Back shouldn't land on the code form again
            navigate(`/session/${shareToken}`, { replace: true });
          },
          onError: (err) => {
            setCheckInError(checkInErrorMessage(err));
            // Busy / offline: refresh the court so the page shows its real state
            if ([409, 503].includes(err?.response?.status)) refetch();
          },
        }
      );
    },
    [qrToken, checkInMutation, navigate, refetch]
  );

  return {
    checkInForm,
    handleCheckIn: checkInForm.handleSubmit(handleCheckIn),
    isCheckingIn: checkInMutation.isPending,
    checkInError,
    // Booked now (or opening for check-in soon): { from, until }
    bookingText: court?.booking
      ? `${dayjs(court.booking.from).format("h:mm A")} – ${dayjs(court.booking.until).format("h:mm A")}`
      : null,
    court,
    venueName: decodeHTML(court?.venueName),
    courtName: decodeHTML(court?.name),
    cameraReady: !!court?.cameraReady,
    busy: !!court?.busy,
    busyUntilText: court?.busyUntil ? dayjs(court.busyUntil).format("h:mm A") : null,
    maxSaves: court?.maxSaves || 5,
    // The venue streams this court (only sent while streaming and the box is online)
    liveWatchUrl: court?.liveWatchUrl || null,
    // CR-030: the venue's booking page, when it takes online bookings
    bookUrl: court?.bookingToken ? `/book/${court.bookingToken}` : null,
    isLoading,
    isFetching,
    notFound,
    loadError: !notFound ? error : null,
    refetch,
  };
};
