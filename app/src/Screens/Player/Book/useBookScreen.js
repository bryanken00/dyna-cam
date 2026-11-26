import * as WebBrowser from "expo-web-browser";
import { useMemo } from "react";
import { Linking } from "react-native";
import Toast from "react-native-toast-message";
import { useNearMe } from "@/hooks/useNearMe";
import { playerErrorMessage } from "@/services/requests/player";
import { useVenues } from "@/services/requests/venues";
import { distanceKm, hasPin } from "@/utils/geo";

/**
 * The Book tab's state (PLAN-009 A1): the venue list, Near me (distance from
 * the phone, nearest first; venues with no pin last), Book (the venue's
 * booking page in the in-app browser — the native booking screens are slice
 * A2) and Directions (Google Maps).
 */
export const useBookScreen = () => {
  const venues = useVenues();
  const near = useNearMe();

  const list = useMemo(() => {
    const all = venues.data?.data?.venues || [];
    if (!near.position) return all.map((v) => ({ ...v, distanceKm: null }));
    return all
      .map((v) => ({ ...v, distanceKm: hasPin(v) ? distanceKm(near.position, v) : null }))
      .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
  }, [venues.data, near.position]);

  const book = async (venue) => {
    if (!venue.bookingUrl) {
      Toast.show({ type: "info", text1: "Booking opens in the next app update" });
      return;
    }
    try {
      await WebBrowser.openBrowserAsync(venue.bookingUrl);
    } catch {
      Toast.show({ type: "error", text1: "Couldn't open the booking page" });
    }
  };

  const directions = async (venue) => {
    try {
      await Linking.openURL(venue.directionsUrl);
    } catch {
      Toast.show({ type: "error", text1: "Couldn't open Maps" });
    }
  };

  return {
    venues: list,
    isLoading: venues.isLoading,
    isError: venues.isError,
    errorMessage: venues.isError ? playerErrorMessage(venues.error, "Couldn't load the venues.") : null,
    refreshing: venues.isRefetching,
    refresh: venues.refetch,
    nearMe: Boolean(near.position),
    locating: near.locating,
    locationError: near.error,
    toggleNearMe: near.position ? near.clear : near.locate,
    book,
    directions,
  };
};
