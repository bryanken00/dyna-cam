import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  confirmScheduleWeekApi,
  getBookingSettingsApi,
  getScheduleRemindersApi,
  issueBookingLinkApi,
  turnOffBookingLinkApi,
  updateBookingSettingsApi,
  issueDisplayLinkApi,
  turnOffDisplayLinkApi,
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

// Mutation: CR-038 — turn the TV court board on / issue a new link (a TV on the old one stops)
export const useIssueDisplayLink = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: issueDisplayLinkApi,
    onSuccess: (_data, venueId) => {
      toast.success("TV board link ready — open it on the venue's TV");
      queryClient.invalidateQueries({ queryKey: ["bookingSettings", venueId] });
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || "Failed to issue a TV board link");
    },
  });
};

// Mutation: CR-038 — turn the TV court board off
export const useTurnOffDisplayLink = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: turnOffDisplayLinkApi,
    onSuccess: (_data, venueId) => {
      toast.success("TV board turned off");
      queryClient.invalidateQueries({ queryKey: ["bookingSettings", venueId] });
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || "Failed to turn the TV board off");
    },
  });
};

// Query: CR-043 — venues whose next week isn't confirmed (the Dashboard notice) → data.reminders
export const useGetScheduleReminders = (options = {}) => {
  return useQuery({
    queryKey: ["bookingSettings", "scheduleReminders"],
    queryFn: getScheduleRemindersApi,
    staleTime: 60 * 1000, // 1 minute
    ...options,
  });
};

// Mutation: CR-043 — confirm next week's schedule so players can book it online
export const useConfirmScheduleWeek = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: confirmScheduleWeekApi,
    onSuccess: (data) => {
      toast.success(data?.message || "Next week's schedule is confirmed");
      // Both the venue's settings and the Dashboard's reminders
      queryClient.invalidateQueries({ queryKey: ["bookingSettings"] });
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || "Failed to confirm next week's schedule");
    },
  });
};
