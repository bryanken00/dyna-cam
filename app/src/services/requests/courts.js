/**
 * Request hooks — Courts (read-only in the app; permission venues / courts)
 *
 * Demo mode: every hook resolves from `constants/demo.js` without touching
 * the network, in the API's exact envelope.
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { IS_DEMO } from "../../constants";
import {
  DEMO_COURTS,
  DEMO_VENUES,
  demoDelay,
  demoEnvelope,
  demoError,
  demoPage,
} from "../../constants/demo";
import { getCourtApi, getCourtOptionsApi, getCourtsApi } from "../api/courts";

const KEY = "courts";

/** Filters the fixtures the way the server's WHERE clause would. */
const demoList = ({ venueId, search, ...paging } = {}) => {
  const q = search?.toLowerCase();
  const rows = DEMO_COURTS.filter(
    (c) =>
      (!venueId || c.venueId === venueId) &&
      (!q ||
        c.name.toLowerCase().includes(q) ||
        c.venueName.toLowerCase().includes(q)),
  );
  return demoPage("courts", "Courts retrieved successfully", rows, paging);
};

// ─────────────────────────────────────────────────────────────────────────────
// useGetCourts
// ─────────────────────────────────────────────────────────────────────────────
export const useGetCourts = (params = {}, options = {}) => {
  return useQuery({
    queryKey: [KEY, params],
    queryFn: async () => {
      if (IS_DEMO) {
        await demoDelay();
        return demoList(params);
      }
      return getCourtsApi(params);
    },
    placeholderData: keepPreviousData,
    ...options,
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// useGetCourtOptions — venues for the venue filter
// ─────────────────────────────────────────────────────────────────────────────
export const useGetCourtOptions = (options = {}) => {
  return useQuery({
    queryKey: [KEY, "options"],
    queryFn: async () => {
      if (IS_DEMO) {
        await demoDelay();
        return demoEnvelope("Venue options", { venues: DEMO_VENUES });
      }
      return getCourtOptionsApi();
    },
    staleTime: 5 * 60 * 1000,
    ...options,
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// useGetCourt
// ─────────────────────────────────────────────────────────────────────────────
export const useGetCourt = (courtId) => {
  return useQuery({
    queryKey: [KEY, courtId],
    queryFn: async () => {
      if (IS_DEMO) {
        await demoDelay();
        const court = DEMO_COURTS.find((c) => c.courtId === courtId);
        if (!court) throw demoError(404, "Court not found");
        return demoEnvelope("Court retrieved successfully", { court });
      }
      return getCourtApi(courtId);
    },
    enabled: Boolean(courtId),
  });
};
