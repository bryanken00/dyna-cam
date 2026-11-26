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
// CR-047: a pick in the URL — "<courtKey>@HH:mm"
const PICK_PARAM = /^[a-f0-9]{16}@\d{2}:\d{2}$/;
const pickId = (courtKey, startTime) => `${courtKey}@${startTime}`;

// Picks are kept per date while the page is open: another date starts empty, and
// coming back to a date brings its picks back. A reload starts over (with a warning
// first). Booking still takes one date at a time.

// Set just before leaving for the checkout or Google's sign-in, so the reload warning stays quiet
let leavingOnPurpose = false;

/** byDate with one date's picks replaced (removed when empty) */
const withDatePicks = (byDate, day, picks) => {
  const next = { ...byDate };
  if (picks.size > 0) next[day] = [...picks];
  else delete next[day];
  return next;
};

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
 * Picks → what gets booked (CR-047): per court, neighbouring hours joined into
 * one booking (one game); a gap starts another. → [{ courtKey, courtName,
 * startTime, hours, start, end, price }]
 */
const joinPicks = (picks, availability, date) => {
  if (!availability || !date) return [];
  const runs = [];
  for (const court of availability.courts) {
    let run = null;
    for (const s of court.slots) {
      if (!picks.has(pickId(court.key, s.startTime)) || !s.available) {
        run = null;
        continue;
      }
      if (run) {
        run.hours += 1;
        run.price += s.price;
        run.end = run.end.add(60, "minute");
      } else {
        const start = dayjs(`${date} ${s.startTime}`);
        run = {
          courtKey: court.key,
          courtName: decodeHTML(court.name),
          startTime: s.startTime,
          hours: 1,
          price: s.price,
          start,
          end: start.add(60, "minute"),
        };
        runs.push(run);
      }
    }
  }
  return runs;
};

/**
 * `/book/:bookingToken` (PLAN-003 Phase C): pick a date, then tap the hours you
 * want on any courts (CR-047 — no length: neighbouring hours on a court join
 * into one game, and several courts are paid in one checkout), and book. The
 * hour that's running is bookable in its first half. Paid online (CR-046).
 * PLAN-006: booking needs a Google sign-in — the picks ride along in the URL
 * (?date&picks), so the player comes back from Google to the same picks.
 */
export const useBookPageHooks = () => {
  const { bookingToken } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
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
  // CR-047: every hour tapped, as "<courtKey>@HH:mm", per date. Only the URL's picks (back
  // from signing in) come in, for the URL's date — then leave the URL, so a reload clears them
  const [picksByDate, setPicksByDate] = useState(() => {
    const urlDate = searchParams.get("date");
    const urlPicks = (searchParams.get("picks") || "").split(",").filter((p) => PICK_PARAM.test(p));
    return DATE_PARAM.test(urlDate || "") && urlPicks.length > 0 ? { [urlDate]: urlPicks } : {};
  });
  const hadUrlPicks = searchParams.has("picks");
  useEffect(() => {
    if (!hadUrlPicks) return;
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("picks");
        return next;
      },
      { replace: true },
    );
  }, [hadUrlPicks, setSearchParams]);

  // Reloading or closing the tab with hours picked asks first (the picks would be lost).
  // Leaving for the checkout or Google's sign-in doesn't: the picks are booked or travel along.
  const hasPicks = Object.keys(picksByDate).length > 0;
  useEffect(() => {
    if (!hasPicks) return undefined;
    leavingOnPurpose = false;
    const warn = (event) => {
      if (leavingOnPurpose) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasPicks]);
  const handleLeaveToSignIn = useCallback(() => {
    leavingOnPurpose = true;
  }, []);
  const [bookError, setBookError] = useState("");
  const [isRedirecting, setIsRedirecting] = useState(false);

  // A date from the URL counts only if it can still be booked
  const datePicked = pickedDate && pageData && pickedDate >= pageData.today && pickedDate <= pageData.lastDate;
  const date = datePicked ? pickedDate : pageData?.today || null;
  // PLAN-006: off on this server → no online booking (the page shows the venue's phone)
  const signInAvailable = pageData?.signInAvailable !== false;
  const payOnline = !!pageData?.payOnline;
  // CR-033: online payment is the built-in test checkout, not Xendit
  const paymentSandbox = !!pageData?.paymentSandbox;

  // The picks shown: the chosen date's only
  const picks = useMemo(() => new Set((date && picksByDate[date]) || []), [picksByDate, date]);


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

  const {
    data: availabilityData,
    isLoading: availabilityLoading,
    isFetching: availabilityFetching,
    error: availabilityError,
    refetch: refetchAvailability,
  } = useGetAvailability({ bookingToken, date, durationMinutes: 60 });
  const availability = availabilityData?.data || null;

  const bookMutation = useCreatePlayerBooking();

  const form = useForm({
    resolver: zodResolver(detailsSchema),
    defaultValues: { phone: "" },
    mode: "onTouched",
  });

  // The phone from the player's profile, unless they've typed one already
  const lastPhone = player?.phone || "";
  useEffect(() => {
    if (lastPhone && !form.getFieldState("phone").isDirty) form.setValue("phone", lastPhone);
  }, [lastPhone, form]);

  // ─── Handlers ──────────────────────────────────────────────────────
  // Another date shows its own picks (none yet → empty); the old date's are kept
  const handlePickDate = useCallback((value) => {
    setPickedDate(value);
    setBookError("");
  }, []);

  // CR-047: tap an hour to add it, tap again to take it off
  const handleTogglePick = useCallback(
    (courtKey, startTime) => {
      if (!date) return;
      setPicksByDate((current) => {
        const next = new Set(current[date] || []);
        const id = pickId(courtKey, startTime);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return withDatePicks(current, date, next);
      });
      setBookError("");
    },
    [date],
  );

  const handleClearPicks = useCallback(() => {
    if (!date) return;
    setPicksByDate((current) => withDatePicks(current, date, new Set()));
    setBookError("");
  }, [date]);

  const isPicked = useCallback((courtKey, startTime) => picks.has(pickId(courtKey, startTime)), [picks]);

  // What will be booked: one game per run of neighbouring hours on a court
  const runs = useMemo(() => joinPicks(picks, availability, date), [picks, availability, date]);
  const picked = useMemo(() => {
    if (runs.length === 0) return null;
    return {
      runs,
      total: runs.reduce((sum, r) => sum + r.price, 0),
    };
  }, [runs]);

  const handleBook = useCallback(
    (values) => {
      if (!picked) return;
      setBookError("");
      const slots = [];
      for (const run of picked.runs) {
        for (let i = 0; i < run.hours; i += 1) {
          slots.push({ courtKey: run.courtKey, startTime: run.start.add(i * 60, "minute").format("HH:mm") });
        }
      }
      bookMutation.mutate(
        {
          bookingToken,
          body: { date, slots, phone: values.phone.trim() || null, payMethod: "Online" },
        },
        {
          onSuccess: (response) => {
            const token = response?.data?.manageToken;
            if (!token) {
              setBookError("Something went wrong. Please try again.");
              return;
            }
            // Booked: this date's picks are done
            setPicksByDate((current) => withDatePicks(current, date, new Set()));
            // Phase F: off to Xendit's checkout (one for everything picked); it sends
            // the player back to the first booking's page, which waits for the payment
            const checkoutUrl = response?.data?.checkoutUrl;
            if (checkoutUrl) {
              leavingOnPurpose = true;
              setIsRedirecting(true);
              window.location.assign(checkoutUrl);
              return;
            }
            // Nothing to pay: replace, so Back doesn't land on a form that would book again
            navigate(response?.data?.bookings?.length > 1 ? "/me/games" : `/booking/${token}`, {
              replace: true,
            });
          },
          onError: (err) => {
            setBookError(bookErrorMessage(err));
            // Taken meanwhile, or the page is out of date: show the real state
            if ([400, 409].includes(err?.response?.status)) refetchAvailability();
            if (err?.response?.status === 404) refetch();
          },
        },
      );
    },
    [picked, bookMutation, bookingToken, date, navigate, refetchAvailability, refetch],
  );

  // Where Google brings a signed-out player back to: this page with their picks
  const signInReturnPath = useMemo(() => {
    const query = new URLSearchParams();
    if (date) query.set("date", date);
    if (picks.size > 0) query.set("picks", [...picks].join(","));
    return `/book/${bookingToken}?${query}`;
  }, [bookingToken, date, picks]);
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
    handleLeaveToSignIn,
    venueName: decodeHTML(pageData?.venue?.name),
    isLoading,
    isFetching,
    notFound: error?.response?.status === 404,
    loadError: error?.response?.status !== 404 ? error : null,
    refetch,
    dates,
    date,
    availability,
    availabilityLoading,
    availabilityFetching,
    availabilityError,
    isPicked,
    picked,
    handlePickDate,
    handleTogglePick,
    handleClearPicks,
    form,
    handleBook: form.handleSubmit(handleBook),
    payOnline,
    paymentSandbox,
    isBooking: bookMutation.isPending || isRedirecting,
    bookError,
  };
};
