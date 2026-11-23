import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  checkInBookingApi,
  createPublicBookingApi,
  getAvailabilityApi,
  getBookingPageApi,
  getMyBookingApi,
  payBookingOnlineApi,
} from "../../api/public/bookings";

// A 404 means the link isn't valid (turned off, replaced) — don't retry it
const retryUnless404 = (count, error) => error?.response?.status !== 404 && count < 2;

// Query: the venue's booking page
export const useGetBookingPage = (bookingToken) => {
  return useQuery({
    queryKey: ["publicBookingPage", bookingToken],
    queryFn: () => getBookingPageApi(bookingToken),
    enabled: !!bookingToken,
    staleTime: 5 * 60 * 1000,
    retry: retryUnless404,
  });
};

// Query: free hours for a date and length — refreshed now and then while open
export const useGetAvailability = ({ bookingToken, date, durationMinutes }) => {
  return useQuery({
    queryKey: ["publicAvailability", bookingToken, date, durationMinutes],
    queryFn: () => getAvailabilityApi({ bookingToken, date, durationMinutes }),
    enabled: !!bookingToken && !!date && !!durationMinutes,
    staleTime: 20 * 1000,
    refetchInterval: 60 * 1000,
    placeholderData: keepPreviousData,
    retry: retryUnless404,
  });
};

// Mutation: book a slot. The page shows errors itself, so no toast here.
export const useCreatePublicBooking = () => {
  return useMutation({ mutationFn: createPublicBookingApi });
};

// Query: one booking by its own link. While it's waiting for payment, check
// again now and then so the page flips to Confirmed once the desk takes it —
// every few seconds while an online checkout is open (Phase F: the player is
// back from Xendit and the payment is on its way).
export const useGetMyBooking = (manageToken) => {
  return useQuery({
    queryKey: ["publicBooking", manageToken],
    queryFn: () => getMyBookingApi(manageToken),
    enabled: !!manageToken,
    staleTime: 15 * 1000,
    retry: retryUnless404,
    refetchInterval: (query) => {
      const booking = query.state.data?.data?.booking;
      if (booking?.status !== "Pending") return false;
      return booking.checkoutOpen ? 5 * 1000 : 30 * 1000;
    },
  });
};

// Mutation: Phase F — open (or reopen) the booking's online checkout. The page
// sends the player to checkoutUrl and shows errors itself.
export const usePayBookingOnline = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: payBookingOnlineApi,
    onSuccess: (_data, manageToken) => {
      queryClient.invalidateQueries({ queryKey: ["publicBooking", manageToken] });
    },
  });
};

// Mutation: Phase D — check the booking in. The page shows errors itself.
export const useCheckInBooking = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: checkInBookingApi,
    onSuccess: (_data, manageToken) => {
      queryClient.invalidateQueries({ queryKey: ["publicBooking", manageToken] });
    },
  });
};
