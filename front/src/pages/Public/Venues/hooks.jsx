import { useMemo, useState } from "react";
import dayjs from "dayjs";

import { decodeHTML } from "../../../utils/decode-html";
import { formatPhoneDisplay } from "../../../utils/phoneFormat";
import { getImageUrl } from "../../../utils/upload";
import { useGetPublicVenues } from "../../../services/requests/public/bookings";
import { useProfileRedirect } from "../../../services/requests/public/player";
import { usePlayerSignedIn } from "../../../store/playerStore";

/** "06:00" → "6 AM", "17:30" → "5:30 PM", "24:00" → "midnight", CR-049: "25:00" → "1 AM". */
const clock = (hhmm) => {
  if (hhmm === "24:00") return "midnight";
  const [h, m] = hhmm.split(":").map(Number);
  const time = dayjs("2000-01-01").add(h * 60 + m, "minute");
  return time.format(time.minute() ? "h:mm A" : "h A");
};

/** Today's hours as one line: "Open today 6 AM – 11 PM", or "Closed today". */
const todayText = (hours) =>
  hours ? `Open today ${clock(hours.opensAt)} – ${clock(hours.closesAt)}` : "Closed today";

/**
 * `/book` (CR-030): every venue taking online bookings, filtered by what the
 * player types (name or address). Each card opens the venue's booking page.
 * PLAN-006: a signed-out player is asked to sign in with Google first.
 */
export const useVenuesPageHooks = () => {
  const [search, setSearch] = useState("");
  const signedIn = usePlayerSignedIn();
  // A first sign-in completes the profile (name, phone) before booking
  const profileRedirect = useProfileRedirect("/book");
  const { data, isLoading, error, refetch, isFetching } = useGetPublicVenues();

  const venues = useMemo(
    () =>
      (data?.data?.venues || []).map((v) => ({
        key: v.bookingToken,
        to: `/book/${v.bookingToken}`,
        name: decodeHTML(v.name),
        address: decodeHTML(v.address || ""),
        phone: v.phone ? formatPhoneDisplay(v.phone) : "",
        logo: getImageUrl(v.logoUrl),
        courts: v.courtCount === 1 ? "1 court" : `${v.courtCount} courts`,
        today: todayText(v.todayHours),
        openToday: !!v.todayHours,
      })),
    [data]
  );

  const shown = useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return venues;
    return venues.filter((v) => {
      const text = `${v.name} ${v.address}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }, [venues, search]);

  return {
    signedIn,
    profileRedirect,
    // Off on this server: nobody can book online (the desk still can)
    signInAvailable: data?.data?.signInAvailable !== false,
    venues: shown,
    total: venues.length,
    search,
    handleSearch: setSearch,
    handleClearSearch: () => setSearch(""),
    isLoading,
    isFetching,
    loadError: error,
    refetch,
  };
};
