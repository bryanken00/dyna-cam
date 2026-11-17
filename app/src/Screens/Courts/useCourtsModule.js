import { useMemo, useState } from "react";
import useDebounce from "@/hooks/useDebounce";
import { useGetCourtOptions, useGetCourts } from "@/services/requests/courts";

/**
 * Module state for Courts: search, the venue filter, paging, and the server
 * data behind them. Read-only — courts are set up in the web portal.
 *
 * A venue has a handful of courts, so a page holds 100 (the API's maximum):
 * in practice the whole list is one page, already sorted venue → court by
 * the API, and the stats below are true for every court. When there are more
 * than fit, the pager takes over and the stats are hidden rather than wrong.
 *
 * The response is unwrapped here and nowhere else.
 */

const PAGE_SIZE = 100;

/** A court can save clips now when it is Active, has a camera and its box is up. */
export const courtReady = (court) =>
  court.status === "Active" && court.camera?.configured && court.recorderOnline;

export const useCourtsModule = () => {
  const [search, setSearch] = useState("");
  const [venueId, setVenueId] = useState(null); // null = all venues
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);

  const debouncedSearch = useDebounce(search.trim(), 300);

  const query = useGetCourts({
    page,
    pageSize: PAGE_SIZE,
    search: debouncedSearch || undefined,
    venueId: venueId || undefined,
  });
  const options = useGetCourtOptions();

  const pageItems = query.data?.data?.courts ?? [];
  const total = query.data?.data?.pagination?.total ?? pageItems.length;
  const venues = options.data?.data?.venues ?? [];

  const stats = useMemo(() => {
    if (total > pageItems.length) return null; // can't be true across pages
    const ready = pageItems.filter(courtReady).length;
    return { total, ready, attention: total - ready };
  }, [pageItems, total]);

  const hasActiveFilters = Boolean(venueId);

  return {
    // data
    pageItems,
    stats,
    total,
    venues,
    isLoading: query.isLoading,
    isError: query.isError,
    isRefreshing: query.isRefetching && !query.isPlaceholderData,
    refresh: () => {
      query.refetch();
      options.refetch();
    },
    // search + filter
    search,
    setSearch: (v) => {
      setSearch(v);
      setPage(1);
    },
    venueId,
    setVenueId: (v) => {
      setVenueId(v);
      setPage(1);
    },
    showFilters,
    setShowFilters,
    hasActiveFilters,
    clearFilters: () => {
      setVenueId(null);
      setPage(1);
    },
    // pagination
    page,
    pageSize: PAGE_SIZE,
    setPage,
  };
};

export default useCourtsModule;
