import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getClipsApi, getClipOptionsApi } from "../../api/admin/clips";

/** Clips are view only (PLAN-002 Phase E): no staff save, no delete. */

// Query: Get all clips (filters: venueId, courtId, source, status, dateFrom, dateTo)
export const useGetClips = (filters = {}) => {
  return useQuery({
    queryKey: ["clips", filters],
    queryFn: () => getClipsApi(filters),
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
    // Pending clips turn Ready within a minute or two — keep the list moving
    refetchInterval: (query) =>
      query.state.data?.data?.clips?.some((c) =>
        ["Pending", "Processing"].includes(c.status),
      )
        ? 15 * 1000
        : false,
  });
};

// Query: venues + courts for the filters → { venues, courts }
export const useGetClipOptions = (options = {}) => {
  return useQuery({
    queryKey: ["clips", "options"],
    queryFn: getClipOptionsApi,
    staleTime: 5 * 60 * 1000,
    ...options,
  });
};
