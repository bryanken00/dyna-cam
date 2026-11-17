import { useMemo, useState } from "react";
import useDebounce from "@/hooks/useDebounce";
import { useGetDevices } from "@/services/requests/devices";

/**
 * Module state for Recorder boxes (read-only — boxes are added, renamed and
 * revoked in the web portal, where the one-time token can be copied).
 *
 * A venue has one box, so a page of 100 (the API's maximum) is in practice
 * all of them, and the online/offline counts are true. With more than that
 * the pager takes over and the counts are hidden rather than wrong.
 *
 * `online` and `lastSeenSecondsAgo` are computed by the API from the last
 * heartbeat (every 30s; online = seen in the last 90s), so the phone's clock
 * doesn't matter. Pull to refresh for a fresh reading.
 */

const PAGE_SIZE = 100;

export const useRecorderBoxesModule = () => {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search.trim(), 300);

  const query = useGetDevices({
    page,
    pageSize: PAGE_SIZE,
    search: debouncedSearch || undefined,
  });

  const pageItems = query.data?.data?.devices ?? [];
  const total = query.data?.data?.pagination?.total ?? pageItems.length;

  const stats = useMemo(() => {
    if (total > pageItems.length) return null;
    const active = pageItems.filter((d) => d.status === "Active");
    const online = active.filter((d) => d.online).length;
    return { total, online, offline: active.length - online };
  }, [pageItems, total]);

  return {
    pageItems,
    stats,
    total,
    isLoading: query.isLoading,
    isError: query.isError,
    isRefreshing: query.isRefetching && !query.isPlaceholderData,
    refresh: query.refetch,
    search,
    setSearch: (v) => {
      setSearch(v);
      setPage(1);
    },
    page,
    pageSize: PAGE_SIZE,
    setPage,
  };
};

export default useRecorderBoxesModule;
