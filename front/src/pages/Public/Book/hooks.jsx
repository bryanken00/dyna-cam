import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import dayjs from "dayjs";
import { z } from "zod";

import { decodeHTML } from "../../../utils/decode-html";
import { zPhone } from "../../../utils/phoneFormat";
import { useGetAvailability, useGetBookingPage } from "../../../services/requests/public/bookings";
import {
  useCreatePlayerBooking,
  useGetPlayerMe,
  useProfileRedirect,
} from "../../../services/requests/public/player";
import { usePlayerSignedIn } from "../../../store/playerStore";

// Mirrors publicBookingSchema — PLAN-006: the name and email are the signed-in
// player's (from Google); only the phone is asked, and it's optional
const detailsSchema = z.object({
  phone: zPhone,
});

const DATE_PARAM = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PARAM = /^\d{2}:\d{2}$/;
const COURT_PARAM = /^[a-f0-9]{16}$/;

/** A failed booking → the sentence under the button. */
const bookErrorMessage = (error) => {
  const status = error?.response?.status;
  const apiMessage = error?.response?.data?.message;
  if (status === 429) return apiMessage || "Too many tries — wait a minute and try again.";
  if (status === 401) return "Your sign-in has ended — sign in with Google again to book.";
  if (!error?.response) return "Couldn't reach DGSports — check your connection and try again.";
  return apiMessage || "Something went wrong. Please try again.";
};

/**
 * `/book/:bookingToken` (PLAN-003 Phase C): pick a date, a length, a court and
 * a start time, add who's playing, and book. Phase F: pay now online (the
 * player is sent to Xendit's checkout) or at the desk. PLAN-006: booking needs
 * a Google sign-in — the picks ride along in the URL (?date&len&court&time),
 * so the player comes back from Google to the same slot.
 */
export const useBookPageHooks = () => {
  const { bookingToken } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const { data, isLoading, error, refetch, isFetching } = useGetBookingPage(bookingToken);
  const pageData = data?.data || null;

  // ─── The player ────────────────────────────────────────────────────
  const signedIn = usePlayerSignedIn();
  const { data: meData, isLoading: playerLoading } = useGetPlayerMe();
  const player = meData?.data?.player || null;

  // ─── Picks (from the URL when back from signing in) ────────────────
  const [pickedDate, setPickedDate] = useState(() => {
    const value = searchParams.get("date");
    return DATE_PARAM.test(value || "") ? value : null;
  });
  const [durationMinutes, setDurationMinutes] = useState(() => {
    const value = Number(searchParams.get("len"));
    return Number.isInteger(value) && value > 0 && value % 60 === 0 ? value : 60;
  });
  // { courtKey, startTime } — cleared whenever the date or length changes
  const [slot, setSlot] = useState(() => {
    const courtKey = searchParams.get("court");
    const startTime = searchParams.get("time");
    return COURT_PARAM.test(courtKey || "") && TIME_PARAM.test(startTime || "")
      ? { courtKey, startTime }
      : null;
  });
  const [bookError, setBookError] = useState("");
  // "Online" | "Desk" — null until the player picks (Online first when it's on)
  const [pickedPayMethod, setPickedPayMethod] = useState(null);
  const [isRedirecting, setIsRedirecting] = useState(false);

  // A date from the URL counts only if it can still be booked
  const datePicked = pickedDate && pageData && pickedDate >= pageData.today && pickedDate <= pageData.lastDate;
  const date = datePicked ? pickedDate : pageData?.today || null;
  // PLAN-006: off on this server → no online booking (the page shows the venue's phone)
  const signInAvailable = pageData?.signInAvailable !== false;
  const payOnline = !!pageData?.payOnline;
  // CR-033: online payment is the built-in test checkout, not Xendit
  const paymentSandbox = !!pageData?.paymentSandbox;
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

  const bookMutation = useCreatePlayerBooking();

  const form = useForm({
    resolver: zodResolver(detailsSchema),
    defaultValues: { phone: "" },
    mode: "onTouched",
  });

  // The phone from the player's last booking, unless they've typed one already
  const lastPhone = player?.phone || "";
  useEffect(() => {
    if (lastPhone && !form.getFieldState("phone").isDirty) form.setValue("phone", lastPhone);
  }, [lastPhone, form]);

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

  // Where Google brings a signed-out player back to: this page with their picks
  const signInReturnPath = useMemo(() => {
    const query = new URLSearchParams();
    if (date) query.set("date", date);
    query.set("len", String(durationMinutes));
    if (slot) {
      query.set("court", slot.courtKey);
      query.set("time", slot.startTime);
    }
    return `/book/${bookingToken}?${query}`;
  }, [bookingToken, date, durationMinutes, slot]);
  const profileRedirect = useProfileRedirect(signInReturnPath);

  return {
    page: pageData,
    signedIn,
    // A first sign-in completes the profile (name, phone) before booking — back here after
    profileRedirect,
    player,
    playerLoading: signedIn && playerLoading,
    signInAvailable,
    signInReturnPath,
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
    paymentSandbox,
    payMethod,
    handlePickPayMethod,
    isBooking: bookMutation.isPending || isRedirecting,
    bookError,
  };
};
