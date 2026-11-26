import { useCallback, useMemo, useState } from "react";
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

/** CR-050: km between two points (haversine) — accurate enough for "2.4 km away". */
const distanceKm = (a, b) => {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};

/** 0.35 → "350 m away", 2.43 → "2.4 km away", 31.6 → "32 km away". */
const distanceText = (km) =>
  km < 1 ? `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m away` : `${km < 10 ? km.toFixed(1) : Math.round(km)} km away`;

/** Why the browser didn't give a location → the line under the button. */
const locationProblem = (error) => {
  if (!window.isSecureContext) return "Your location only works on a secure (https) page.";
  if (error?.code === 1) return "Location is blocked — allow it for this site in your browser, then try again.";
  if (error?.code === 3) return "Finding your location took too long — try again.";
  return "Couldn't find your location — try again.";
};

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
        // CR-050: Google Maps directions to the venue's pin (null: no pin)
        directionsUrl: v.directionsUrl || null,
        pin: Number.isFinite(v.latitude) && Number.isFinite(v.longitude) ? { latitude: v.latitude, longitude: v.longitude } : null,
      })),
    [data]
  );

  // ─── CR-050: Near me — the browser's location, used only here (never sent to the API) ───
  const [myLocation, setMyLocation] = useState(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState("");

  const handleNearMe = useCallback(() => {
    if (!navigator.geolocation || !window.isSecureContext) {
      setLocationError(locationProblem(null));
      return;
    }
    setLocating(true);
    setLocationError("");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setMyLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude });
        setLocating(false);
      },
      (error) => {
        setLocationError(locationProblem(error));
        setLocating(false);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 }
    );
  }, []);
  const handleClearNearMe = useCallback(() => {
    setMyLocation(null);
    setLocationError("");
  }, []);

  const shown = useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matching = words.length
      ? venues.filter((v) => {
          const text = `${v.name} ${v.address}`.toLowerCase();
          return words.every((w) => text.includes(w));
        })
      : venues;
    if (!myLocation) return matching;
    // Nearest first; venues without a pin last, in their usual order
    return matching
      .map((v) => {
        const km = v.pin ? distanceKm(myLocation, v.pin) : null;
        return { ...v, km, distance: km === null ? "" : distanceText(km) };
      })
      .sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity));
  }, [venues, search, myLocation]);

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
    nearMe: !!myLocation,
    locating,
    locationError,
    handleNearMe,
    handleClearNearMe,
    isLoading,
    isFetching,
    loadError: error,
    refetch,
  };
};
