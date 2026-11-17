import { useRoute } from "@react-navigation/native";
import { useMemo, useState } from "react";
import { useGetClipOptions, useGetClips } from "@/services/requests/clips";

/**
 * Module state for Clips: the venue / court / status / payment filters,
 * paging, and the server data behind them.
 *
 * Filtering and paging run on the server; every input is in the query key.
 * The API has no text search for clips, so there is no search box — the
 * filters are the way in. A court's detail screen opens this pre-filtered to
 * that court (route params `{ venueId, courtId }`).
 *
 * The response is unwrapped here and nowhere else.
 */

const PAGE_SIZE = 20;

export const useClipsModule = () => {
  const params = useRoute().params ?? {};
  const [venueId, setVenueId] = useState(params.venueId ?? null);
  const [courtId, setCourtId] = useState(params.courtId ?? null);
  const [status, setStatus] = useState(null);
  const [paymentStatus, setPaymentStatus] = useState(
    params.paymentStatus ?? null,
  );
  const [showFilters, setShowFilters] = useState(
    Boolean(params.courtId || params.paymentStatus),
  );
  const [page, setPage] = useState(1);

  const query = useGetClips({
    page,
    pageSize: PAGE_SIZE,
    venueId: venueId || undefined,
    courtId: courtId || undefined,
    status: status || undefined,
    paymentStatus: paymentStatus || undefined,
  });
  const options = useGetClipOptions();

  const pageItems = query.data?.data?.clips ?? [];
  const total = query.data?.data?.pagination?.total ?? pageItems.length;

  const venues = options.data?.data?.venues ?? [];
  const allCourts = options.data?.data?.courts ?? [];
  // Courts narrow to the chosen venue, so the court chips stay short
  const courts = useMemo(
    () => (venueId ? allCourts.filter((c) => c.venueId === venueId) : allCourts),
    [allCourts, venueId],
  );

  const reset = (setter) => (v) => {
    setter(v);
    setPage(1);
  };

  const hasActiveFilters = Boolean(venueId || courtId || status || paymentStatus);

  return {
    // data
    pageItems,
    total,
    venues,
    courts,
    isLoading: query.isLoading,
    isError: query.isError,
    isRefreshing: query.isRefetching && !query.isPlaceholderData,
    refresh: () => {
      query.refetch();
      options.refetch();
    },
    // filters
    venueId,
    setVenueId: (v) => {
      setVenueId(v);
      setCourtId(null); // a court from another venue would match nothing
      setPage(1);
    },
    courtId,
    setCourtId: reset(setCourtId),
    status,
    setStatus: reset(setStatus),
    paymentStatus,
    setPaymentStatus: reset(setPaymentStatus),
    showFilters,
    setShowFilters,
    hasActiveFilters,
    clearFilters: () => {
      setVenueId(null);
      setCourtId(null);
      setStatus(null);
      setPaymentStatus(null);
      setPage(1);
    },
    // pagination
    page,
    pageSize: PAGE_SIZE,
    setPage,
  };
};

export default useClipsModule;
