import { useNavigation, useRoute } from "@react-navigation/native";
import { useEffect, useMemo, useState } from "react";
import useDebounce from "@/hooks/useDebounce";
import usePermissions from "@/hooks/usePermissions";
import { useGetClipOptions } from "@/services/requests/clips";
import {
  useBookSession,
  useCancelSession,
  useEndSession,
  useGetSessions,
} from "@/services/requests/sessions";
import { toEpochMs } from "@/utils/dynaCam";

/**
 * What can be done to a session right now — the same rules the API applies
 * (sessions.controller.js): cancel only before it starts; end only once it
 * has started and is still Scheduled/Recording.
 */
export const sessionActionsFor = (session) => {
  const started = (toEpochMs(session?.startAt) ?? 0) <= Date.now();
  return {
    canCancel: session?.status === "Scheduled" && !started,
    canEnd:
      ["Scheduled", "Recording"].includes(session?.status) && started,
  };
};

/**
 * Module state for Sessions: search, the status filter, paging, the booking
 * sheet and its result, and cancel / end.
 *
 * Search and paging run on the server (search matches the player, court and
 * venue); typing is debounced 300ms before it reaches the query key.
 *
 * A court's detail screen opens this with `{ bookCourtId }`, which opens the
 * booking form on that court once and then clears the param, so going back
 * and forth doesn't reopen it.
 */

const PAGE_SIZE = 20;

/** Long enough for a Modal's slide-out to finish before the next one opens. */
const MODAL_SWAP_MS = 450;

export const useSessionsModule = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { can } = usePermissions();
  const canWrite = can("clips", null, "write");

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);

  // Booking sheet: null = closed, { courtId? } = open
  const [booking, setBooking] = useState(null);
  // The last booking's { shareUrl, courtName, startAt, durationMinutes }
  const [booked, setBooked] = useState(null);

  const bookCourtId = route.params?.bookCourtId;
  useEffect(() => {
    if (!bookCourtId) return;
    setBooking({ courtId: bookCourtId });
    navigation.setParams({ bookCourtId: undefined });
  }, [bookCourtId, navigation]);

  const debouncedSearch = useDebounce(search.trim(), 300);

  const query = useGetSessions({
    page,
    pageSize: PAGE_SIZE,
    search: debouncedSearch || undefined,
    status: status || undefined,
  });
  // Courts for the booking form — under the clips permission, like booking
  const options = useGetClipOptions({ enabled: canWrite });
  const book = useBookSession();
  const cancel = useCancelSession();
  const end = useEndSession();

  const pageItems = query.data?.data?.sessions ?? [];
  const total = query.data?.data?.pagination?.total ?? pageItems.length;

  // Only courts that can record now (court and venue Active)
  const courts = useMemo(
    () => (options.data?.data?.courts ?? []).filter((c) => c.active),
    [options.data],
  );

  const save = (payload) =>
    book.mutate(payload, {
      onSuccess: (response) => {
        const court = courts.find((c) => c.courtId === payload.courtId);
        setBooking(null);
        // Both sheets are Modals. iOS refuses to present one while another
        // is still sliding away, so the result opens after the form has gone.
        setTimeout(
          () =>
            setBooked({
              shareUrl: response.data?.shareUrl,
              courtName: court?.name ?? "",
              startAt: response.data?.startAt ?? `${payload.startAt}:00`,
              durationMinutes: payload.durationMinutes,
            }),
          MODAL_SWAP_MS,
        );
      },
    });

  return {
    // data
    pageItems,
    total,
    courts,
    courtsLoading: options.isLoading,
    isLoading: query.isLoading,
    isError: query.isError,
    isRefreshing: query.isRefetching && !query.isPlaceholderData,
    refresh: query.refetch,
    canWrite,
    // search + filter
    search,
    setSearch: (v) => {
      setSearch(v);
      setPage(1);
    },
    status,
    setStatus: (v) => {
      setStatus(v);
      setPage(1);
    },
    showFilters,
    setShowFilters,
    hasActiveFilters: Boolean(status),
    clearFilters: () => {
      setStatus(null);
      setPage(1);
    },
    // pagination
    page,
    pageSize: PAGE_SIZE,
    setPage,
    // booking
    booking,
    openBooking: (courtId) => setBooking({ courtId }),
    closeBooking: () => setBooking(null),
    save,
    saving: book.isPending,
    booked,
    closeBooked: () => setBooked(null),
    // row actions
    cancelSession: (sessionId) => cancel.mutate(sessionId),
    endSession: (sessionId) => end.mutate(sessionId),
  };
};

export default useSessionsModule;
