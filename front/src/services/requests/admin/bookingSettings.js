import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getBookingSettingsApi,
  issueBookingLinkApi,
  turnOffBookingLinkApi,
  updateBookingSettingsApi,
} from "../../api/admin/bookingSettings";

// Query: a venue's booking setup → data.settings, data.courts
export const useGetBookingSettings = (venueId, options = {}) => {
  return useQuery({
    queryKey: ["bookingSettings", venueId],
    queryFn: () => getBookingSettingsApi(venueId),
    staleTime: 5 * 60 * 1000, // 5 minutes
    ...options,
    enabled: !!venueId && (options.enabled ?? true),
  });
};

// Mutation: save rules + hours + rates
export const useUpdateBookingSettings = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ venueId, settings }) => updateBookingSettingsApi(venueId, settings),
    onSuccess: (_data, { venueId }) => {
      toast.success("Booking settings saved");
      queryClient.invalidateQueries({ queryKey: ["bookingSettings", venueId] });
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || "Failed to save the booking settings");
    },
  });
};

// Mutation: turn online booking on / issue a new link (the old one stops working)
export const useIssueBookingLink = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: issueBookingLinkApi,
    onSuccess: (_data, venueId) => {
      toast.success("Online booking link ready — share it with players");
      queryClient.invalidateQueries({ queryKey: ["bookingSettings", venueId] });
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || "Failed to issue a booking link");
    },
  });
};

// Mutation: turn online booking off
export const useTurnOffBookingLink = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: turnOffBookingLinkApi,
    onSuccess: (_data, venueId) => {
      toast.success("Online booking turned off");
      queryClient.invalidateQueries({ queryKey: ["bookingSettings", venueId] });
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || "Failed to turn online booking off");
    },
  });
};
