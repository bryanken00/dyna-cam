import { useQuery } from "@tanstack/react-query";
import {
  getDashboardAlertsApi,
  getDashboardStatsApi,
  getDashboardVenuesApi,
} from "../../api/admin/dashboard";

/** The heartbeat is every 30 s, so the venue panels refresh at the same pace. */
const VENUE_REFRESH_MS = 30 * 1000;

export const useGetDashboardStats = () =>
  useQuery({
    queryKey: ["dashboard-stats", "admin"],
    queryFn: getDashboardStatsApi,
    staleTime: 60 * 1000,
  });

export const useGetDashboardVenues = () =>
  useQuery({
    queryKey: ["dashboard-venues", "admin"],
    queryFn: getDashboardVenuesApi,
    refetchInterval: VENUE_REFRESH_MS,
    staleTime: 15 * 1000,
  });

export const useGetDashboardAlerts = ({ enabled = true } = {}) =>
  useQuery({
    queryKey: ["dashboard-alerts", "admin"],
    queryFn: getDashboardAlertsApi,
    enabled,
    refetchInterval: VENUE_REFRESH_MS,
    staleTime: 15 * 1000,
  });
