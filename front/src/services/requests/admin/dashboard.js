import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  getDashboardAlertsApi,
  getDashboardInsightsApi,
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

// CR-023: the Insights section (7 or 30 days) — refreshed every 5 minutes
export const useGetDashboardInsights = (days = 7) =>
  useQuery({
    queryKey: ["dashboard-insights", "admin", { days }],
    queryFn: () => getDashboardInsightsApi(days),
    placeholderData: keepPreviousData,
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60 * 1000,
  });

export const useGetDashboardAlerts = ({ enabled = true } = {}) =>
  useQuery({
    queryKey: ["dashboard-alerts", "admin"],
    queryFn: getDashboardAlertsApi,
    enabled,
    refetchInterval: VENUE_REFRESH_MS,
    staleTime: 15 * 1000,
  });
