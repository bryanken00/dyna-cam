import { useCallback, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import dayjs from "dayjs";
import { z } from "zod";

import { decodeHTML } from "../../../utils/decode-html";
import { zPhone } from "../../../utils/phoneFormat";
import {
  useCreatePublicBooking,
  useGetAvailability,
  useGetBookingPage,
} from "../../../services/requests/public/bookings";

// Mirrors publicBookingSchema: name and email required (the email is how the
// player gets their booking link back), phone optional
const detailsSchema = z.object({
  playerName: z.string().trim().min(1, "Enter your name").max(100, "Keep the name under 100 characters"),
  email: z
    .string()
    .trim()
    .min(1, "Enter your email — we send your booking to it")
    .max(255, "Keep the email under 255 characters")
    .email("Enter a valid email"),
  phone: zPhone,
});

/** A failed booking → the sentence under the button. */
const bookErrorMessage = (error) => {
  const status = error?.response?.status;
  const apiMessage = error?.response?.data?.message;
  if (status === 429) return apiMessage || "Too many tries — wait a minute and try again.";
  if (!error?.response) return "Couldn't reach Dyna Cam — check your connection and try again.";
  return apiMessage || "Something went wrong. Please try again.";
};

/**
 * `/book/:bookingToken` (PLAN-003 Phase C): pick a date, a length, a court and
 * a start time, add who's playing, and book. Phase F: pay now online (the
 * player is sent to Xendit's checkout) or at the desk.
 */
export const useBookPageHooks = () => {
  const { bookingToken } = useParams();
  const navigate = useNavigate();

  const { data, isLoading, error, refetch, isFetching } = useGetBookingPage(bookingToken);
  const pageData = data?.data || null;

  // ─── Picks ─────────────────────────────────────────────────────────
  const [pickedDate, setPickedDate] = useState(null);
  const [durationMinutes, setDurationMinutes] = useState(60);
  // { courtKey, startTime } — cleared whenever the date or length changes
  const [slot, setSlot] = useState(null);
  const [bookError, setBookError] = useState("");
  // "Online" | "Desk" — null until the player picks (Online first when it's on)
  const [pickedPayMethod, setPickedPayMethod] = useState(null);
  const [isRedirecting, setIsRedirecting] = useState(false);

  const date = pickedDate || pageData?.today || null;
  const payOnline = !!pageData?.payOnline;
  const payMethod = payOnline ? pickedPayMethod || "Online" : "Desk";

  // Every date from today to the last bookable one, and whether the venue opens then
  const dates = useMemo(() => {
    if (!pageData) return [];
    const open = new Set(pageData.openDays);
    const list = [];
    let d = dayjs(pageData.today);
    const last = dayjs(pageData.lastDate);
    while (!d.isAfter(last, "day")) {
      list.push({ date: d.format("YYYY-MM-DD"), open: open.has(d.day()), day: d });
      d = d.add(1, "day");
    }
    return list;
  }, [pageData]);

  const lengths = useMemo(() => {
    const max = pageData?.rules?.maxBookingMinutes || 60;
    return Array.from({ length: max / 60 }, (_, i) => (i + 1) * 60);
  }, [pageData]);

  const {
    data: availabilityData,
    isLoading: availabilityLoading,
    isFetching: availabilityFetching,
    error: availabilityError,
    refetch: refetchAvailability,
  } = useGetAvailability({ bookingToken, date, durationMinutes });
  const availability = availabilityData?.data || null;

  const bookMutation = useCreatePublicBooking();

  const form = useForm({
    resolver: zodResolver(detailsSchema),
    defaultValues: { playerName: "", email: "", phone: "" },
    mode: "onTouched",
  });

  // ─── Handlers ──────────────────────────────────────────────────────
  const handlePickDate = useCallback((value) => {
    setPickedDate(value);
    setSlot(null);
    setBookError("");
  }, []);

  const handlePickLength = useCallback((minutes) => {
    setDurationMinutes(minutes);
    setSlot(null);
    setBookError("");
  }, []);

  const handlePickPayMethod = useCallback((method) => {
    setPickedPayMethod(method);
    setBookError("");
  }, []);

  const handlePickSlot = useCallback((courtKey, startTime) => {
    setSlot({ courtKey, startTime });
    setBookError("");
  }, []);

  // What the picked slot is: court name, times, price
  const picked = useMemo(() => {
    if (!slot || !availability) return null;
    const court = availability.courts.find((c) => c.key === slot.courtKey);
    const s = court?.slots.find((x) => x.startTime === slot.startTime);
    if (!court || !s?.available) return null;
    const start = dayjs(`${date} ${slot.startTime}`);
    return {
      courtName: decodeHTML(court.name),
      start,
      end: start.add(durationMinutes, "minute"),
      price: s.price,
    };
  }, [slot, availability, date, durationMinutes]);

  const handleBook = useCallback(
    (values) => {
      if (!slot) return;
      setBookError("");
      bookMutation.mutate(
        {
          bookingToken,
          body: {
            courtKey: slot.courtKey,
            date,
            startTime: slot.startTime,
            durationMinutes,
            playerName: values.playerName.trim(),
            email: values.email.trim(),
            phone: values.phone.trim() || null,
            payMethod,
          },
        },
        {
          onSuccess: (response) => {
            const token = response?.data?.manageToken;
            if (!token) {
              setBookError("Something went wrong. Please try again.");
              return;
            }
            // Phase F: off to Xendit's checkout; it sends the player back to the
            // booking's page, which waits for the payment to land
            const checkoutUrl = response?.data?.checkoutUrl;
            if (checkoutUrl) {
              setIsRedirecting(true);
              window.location.assign(checkoutUrl);
              return;
            }
            // replace: Back shouldn't land on a form that would book again
            navigate(`/booking/${token}`, { replace: true });
          },
          onError: (err) => {
            setBookError(bookErrorMessage(err));
            // Taken meanwhile, or the page is out of date: show the real state
            if ([400, 409].includes(err?.response?.status)) {
              setSlot(null);
              refetchAvailability();
            }
            if (err?.response?.status === 404) refetch();
          },
        },
      );
    },
    [slot, bookMutation, bookingToken, date, durationMinutes, payMethod, navigate, refetchAvailability, refetch],
  );

  return {
    page: pageData,
    venueName: decodeHTML(pageData?.venue?.name),
    isLoading,
    isFetching,
    notFound: error?.response?.status === 404,
    loadError: error?.response?.status !== 404 ? error : null,
    refetch,
    dates,
    date,
    lengths,
    durationMinutes,
    availability,
    availabilityLoading,
    availabilityFetching,
    availabilityError,
    slot,
    picked,
    handlePickDate,
    handlePickLength,
    handlePickSlot,
    form,
    handleBook: form.handleSubmit(handleBook),
    payOnline,
    payMethod,
    handlePickPayMethod,
    isBooking: bookMutation.isPending || isRedirecting,
    bookError,
  };
};
