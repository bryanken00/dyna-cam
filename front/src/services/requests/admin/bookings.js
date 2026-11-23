import { toast } from "sonner";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  cancelBookingApi,
  checkInBookingAdminApi,
  createBookingApi,
  deleteBookingApi,
  getBookingByIdApi,
  getBookingDayApi,
  getBookingOptionsApi,
  getBookingQuoteApi,
  getBookingsApi,
  markNoShowApi,
  moveBookingApi,
  recordBookingPaymentApi,
} from "../../api/admin/bookings";

/**
 * A booking change can touch the list, the day grid, the booking itself, its
 * payments and (closures, games) the venue's timeline — invalidate them together.
 */
const invalidateBookings = (queryClient) => {
  queryClient.invalidateQueries({ queryKey: ["bookings"] });
  queryClient.invalidateQueries({ queryKey: ["payments"] });
};

const errorToast = (fallback) => (error) => {
  toast.error(error.response?.data?.message || fallback);
};

// Query: bookings → data.bookings, data.stats, data.pagination
export const useGetBookings = (filters = {}, options = {}) => {
  return useQuery({
    queryKey: ["bookings", "list", filters],
    queryFn: () => getBookingsApi(filters),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
    ...options,
  });
};

// Query: venues + courts for the filters and the drawer → data.venues, data.courts
export const useGetBookingOptions = (options = {}) => {
  return useQuery({
    queryKey: ["bookings", "options"],
    queryFn: getBookingOptionsApi,
    staleTime: 5 * 60 * 1000,
    ...options,
  });
};

// Query: one day at a venue → data.hours, data.courts, data.bookings, data.games, data.closures
export const useGetBookingDay = ({ venueId, date }, options = {}) => {
  return useQuery({
    queryKey: ["bookings", "day", venueId, date],
    queryFn: () => getBookingDayApi({ venueId, date }),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
    ...options,
    enabled: !!venueId && !!date && (options.enabled ?? true),
  });
};

// Query: price + availability of a slot → data.quote
export const useGetBookingQuote = (params, options = {}) => {
  const ready =
    !!params?.courtId && !!params?.date && !!params?.startTime && !!params?.durationMinutes;
  return useQuery({
    queryKey: ["bookings", "quote", params],
    queryFn: () => getBookingQuoteApi(params),
    staleTime: 15 * 1000,
    placeholderData: keepPreviousData,
    ...options,
    enabled: ready && (options.enabled ?? true),
  });
};

// Query: one booking (with payments and its game) → data.booking
export const useGetBookingById = (bookingId, options = {}) => {
  return useQuery({
    queryKey: ["bookings", "detail", bookingId],
    queryFn: () => getBookingByIdApi(bookingId),
    staleTime: 15 * 1000,
    ...options,
    enabled: !!bookingId && (options.enabled ?? true),
  });
};

// Mutation: a desk booking
export const useCreateBooking = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createBookingApi,
    onSuccess: (data) => {
      toast.success(data?.message || "Booking saved");
      invalidateBookings(queryClient);
    },
    onError: errorToast("Failed to save the booking"),
  });
};

// Mutation: move to another time / court
export const useMoveBooking = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ bookingId, move }) => moveBookingApi(bookingId, move),
    onSuccess: () => {
      toast.success("Booking moved");
      invalidateBookings(queryClient);
    },
    onError: errorToast("Failed to move the booking"),
  });
};

// Mutation: cancel (refund by default)
export const useCancelBooking = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ bookingId, cancel }) => cancelBookingApi(bookingId, cancel),
    onSuccess: (data) => {
      toast.success(data?.message || "Booking cancelled");
      invalidateBookings(queryClient);
    },
    onError: errorToast("Failed to cancel the booking"),
  });
};

// Mutation: no-show
export const useMarkNoShow = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: markNoShowApi,
    onSuccess: () => {
      toast.success("Marked as a no-show");
      invalidateBookings(queryClient);
    },
    onError: errorToast("Failed to mark the no-show"),
  });
};

// Mutation: the player paid a held booking at the desk
export const useRecordBookingPayment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ bookingId, payment }) => recordBookingPaymentApi(bookingId, payment),
    onSuccess: () => {
      toast.success("Payment recorded — the booking is confirmed");
      invalidateBookings(queryClient);
    },
    onError: errorToast("Failed to record the payment"),
  });
};

// Mutation: delete a booking made by mistake
export const useDeleteBooking = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteBookingApi,
    onSuccess: () => {
      toast.success("Booking deleted");
      invalidateBookings(queryClient);
    },
    onError: errorToast("Failed to delete the booking"),
  });
};

// Mutation: Phase D — check the booking in (its game starts)
export const useCheckInBooking = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: checkInBookingAdminApi,
    onSuccess: (data) => {
      toast.success(data?.message || "Checked in");
      invalidateBookings(queryClient);
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: errorToast("Failed to check the booking in"),
  });
};
