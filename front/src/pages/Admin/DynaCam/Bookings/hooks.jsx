import { useState, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";
import dayjs from "dayjs";
import { toast } from "sonner";
import { Eye } from "lucide-react";
import RowActions from "../../../../components/RowActions";
import StatusDot from "../../../../components/StatusDot";
import { useDebounce } from "../../../../hooks/useDebounce";
import { usePermissions } from "../../../../hooks/usePermissions";
import { decodeHTML } from "../../../../utils/decode-html";
import { copyText } from "../../../../utils/clipboard";
import { confirm } from "../../../../store/confirmStore";
import { formatPhoneDisplay } from "../../../../utils/phoneFormat";
import {
  BOOKING_PAYMENT_LABEL,
  BOOKING_STATUS_LABEL,
  BOOKING_STATUS_TONE,
  formatPayCode,
  formatPeso,
  formatTimeRange,
  manilaNow,
} from "../../../../utils/dynaCam";
import {
  useGetBookingDay,
  useGetBookingOptions,
  useGetBookings,
} from "../../../../services/requests/admin/bookings";
import {
  useGetBookingSettings,
  useIssueDisplayLink,
  useTurnOffDisplayLink,
} from "../../../../services/requests/admin/bookingSettings";

const EMPTY_FILTERS = { search: "", status: "", dateFrom: "", dateTo: "" };

/**
 * PLAN-003 Phase B — Dyna Cam → Bookings: one venue's day (courts × hours) or
 * the list of its bookings, the New booking drawer and a booking's detail.
 * `?booking=<id>` opens that booking (links from Sessions).
 */
export const useBookingHooks = () => {
  const { hasPermission } = usePermissions();
  const canWrite = hasPermission("bookings", null, "write");

  const [searchParams, setSearchParams] = useSearchParams();

  // ─── View / Filter State ───────────────────────────────────────────
  const [view, setView] = useState("Day");
  // null = the first venue, once the options load
  const [pickedVenueId, setPickedVenueId] = useState(null);
  const [date, setDate] = useState(() => manilaNow().date);
  const [filters, setFilters] = useState(() => ({ ...EMPTY_FILTERS, dateFrom: manilaNow().date }));
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20 });
  const debouncedSearch = useDebounce(filters.search, 500);

  // ─── Drawer / Sheet State ──────────────────────────────────────────
  const [formOpen, setFormOpen] = useState(false);
  // Prefill for New booking: { courtId?, date, startTime? }
  const [formPrefill, setFormPrefill] = useState(null);
  const detailBookingId = searchParams.get("booking");

  // ─── API Hooks ─────────────────────────────────────────────────────
  const { data: optionsData, isLoading: optionsLoading } = useGetBookingOptions();
  const venues = useMemo(() => optionsData?.data?.venues || [], [optionsData]);
  const allCourts = useMemo(() => optionsData?.data?.courts || [], [optionsData]);
  const venueId = pickedVenueId || venues[0]?.venueId || "";

  const venueOptions = useMemo(
    () => venues.map((v) => ({ value: v.venueId, label: decodeHTML(v.name) })),
    [venues],
  );
  const venueCourts = useMemo(
    () => allCourts.filter((c) => c.venueId === venueId && c.status === "Active"),
    [allCourts, venueId],
  );

  const {
    data: dayData,
    isLoading: dayLoading,
    isFetching: dayFetching,
    error: dayError,
    refetch: refetchDay,
  } = useGetBookingDay(
    { venueId, date },
    { enabled: view === "Day", refetchInterval: 60 * 1000 },
  );

  // CR-038: the picked venue's TV court board link (from its booking settings)
  const { data: settingsData } = useGetBookingSettings(venueId);
  const displayUrl = settingsData?.data?.settings?.displayUrl || null;
  const issueDisplayMutation = useIssueDisplayLink();
  const turnOffDisplayMutation = useTurnOffDisplayLink();

  const {
    data: listData,
    isLoading: listLoading,
    isFetching: listFetching,
    error: listError,
    refetch: refetchList,
  } = useGetBookings(
    {
      page: pagination.current,
      pageSize: pagination.pageSize,
      venueId,
      search: debouncedSearch,
      status: filters.status,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
    },
    { enabled: !!venueId },
  );

  // ─── TV court board link (CR-038) ──────────────────────────────────
  const handleIssueDisplayLink = useCallback(async () => {
    if (displayUrl) {
      const ok = await confirm({
        title: "Issue a new TV board link",
        description:
          "A TV showing the board now says the link isn't valid until you open the new one on it.",
        confirmText: "Issue new link",
        cancelText: "Cancel",
        danger: true,
      });
      if (!ok) return;
    }
    issueDisplayMutation.mutate(venueId);
  }, [displayUrl, issueDisplayMutation, venueId]);

  const handleTurnOffDisplayLink = useCallback(async () => {
    const ok = await confirm({
      title: "Turn the TV board off",
      description:
        "A TV showing the board says the link isn't valid. Turning it on again gives a new link.",
      confirmText: "Turn off",
      cancelText: "Cancel",
      danger: true,
    });
    if (ok) turnOffDisplayMutation.mutate(venueId);
  }, [turnOffDisplayMutation, venueId]);

  const handleCopyDisplayLink = useCallback(async () => {
    if (!displayUrl) return;
    const ok = await copyText(displayUrl);
    if (ok) toast.success("TV board link copied");
    else toast.error("Couldn't copy the link");
  }, [displayUrl]);

  // ─── Handlers ──────────────────────────────────────────────────────
  const handleVenueChange = useCallback((value) => {
    setPickedVenueId(value);
    setPagination((prev) => ({ ...prev, current: 1 }));
  }, []);

  const handleDateChange = useCallback((value) => {
    if (value) setDate(value);
  }, []);

  const handleShiftDate = useCallback((days) => {
    setDate((prev) => dayjs(prev).add(days, "day").format("YYYY-MM-DD"));
  }, []);

  const handleToday = useCallback(() => setDate(manilaNow().date), []);

  const handleFilterChange = useCallback((key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPagination((prev) => ({ ...prev, current: 1 }));
  }, []);

  const handleClearFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setPagination((prev) => ({ ...prev, current: 1 }));
  }, []);

  const handleTableChange = useCallback((next) => {
    setPagination({ current: next.current, pageSize: next.pageSize });
  }, []);

  const handleNewBooking = useCallback(
    (prefill = null) => {
      setFormPrefill(prefill || { date });
      setFormOpen(true);
    },
    [date],
  );

  // A free hour in the day grid → New booking for that court and hour
  const handleCellClick = useCallback(
    (courtId, startTime) => handleNewBooking({ courtId, date, startTime }),
    [handleNewBooking, date],
  );

  const handleFormClose = useCallback(() => {
    setFormOpen(false);
    setFormPrefill(null);
  }, []);

  const handleOpenDetail = useCallback(
    (bookingId) => {
      const next = new URLSearchParams(searchParams);
      next.set("booking", bookingId);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const handleCloseDetail = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete("booking");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // After a booking is made, show it
  const handleFormSuccess = useCallback(
    (result) => {
      setFormOpen(false);
      setFormPrefill(null);
      if (result?.bookingId) handleOpenDetail(result.bookingId);
    },
    [handleOpenDetail],
  );

  const { current, pageSize } = pagination;

  // ─── Columns ───────────────────────────────────────────────────────
  // # · when · court · player · code · price · status · ⋮
  const columns = useMemo(
    () => [
      {
        title: "#",
        key: "index",
        width: 56,
        render: (_, __, index) => (
          <span
            className="font-mono"
            style={{ fontSize: 12, color: "var(--color-text-muted)" }}
          >
            {String((current - 1) * pageSize + index + 1).padStart(2, "0")}
          </span>
        ),
      },
      {
        title: "When",
        key: "when",
        width: 200,
        render: (_, record) => (
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-dark)" }}>
              {dayjs(record.startAt).format("ddd, MMM D")}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
              {formatTimeRange(record.startAt, record.endAt)}
            </div>
          </div>
        ),
      },
      {
        title: "Court",
        dataIndex: "courtName",
        key: "courtName",
        width: 150,
        render: (name) => (
          <span style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}>
            {decodeHTML(name)}
          </span>
        ),
      },
      {
        title: "Player",
        key: "player",
        render: (_, record) => (
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => handleOpenDetail(record.bookingId)}
              className="truncate text-left cursor-pointer hover:underline"
              style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-dark)" }}
            >
              {decodeHTML(record.playerName)}
            </button>
            <div className="truncate" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
              {record.phone ? formatPhoneDisplay(record.phone) : record.email || "—"}
            </div>
          </div>
        ),
      },
      {
        title: "Code",
        dataIndex: "bookingCode",
        key: "bookingCode",
        width: 100,
        render: (code) => (
          <span
            className="font-mono"
            style={{ fontSize: 12.5, letterSpacing: "0.06em", color: "var(--color-text-dark)" }}
          >
            {formatPayCode(code)}
          </span>
        ),
      },
      {
        title: "Price",
        key: "price",
        width: 120,
        render: (_, record) => (
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-dark)" }}>
              {formatPeso(record.price)}
            </div>
            <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
              {BOOKING_PAYMENT_LABEL[record.paymentStatus] || record.paymentStatus}
            </div>
          </div>
        ),
      },
      {
        title: "Status",
        dataIndex: "status",
        key: "status",
        width: 140,
        render: (status) => (
          <StatusDot tone={BOOKING_STATUS_TONE[status] || "muted"}>
            {BOOKING_STATUS_LABEL[status] || status}
          </StatusDot>
        ),
      },
      {
        title: "",
        key: "actions",
        width: 60,
        align: "right",
        render: (_, record) => (
          <RowActions
            items={[
              {
                key: "view",
                label: "Open",
                icon: <Eye className="w-4 h-4" />,
                onClick: () => handleOpenDetail(record.bookingId),
              },
            ]}
          />
        ),
      },
    ],
    [current, pageSize, handleOpenDetail],
  );

  // Stable object: the drawer re-hydrates whenever its entity changes
  const formEntity = useMemo(
    () => (formPrefill ? { venueId, courts: venueCourts, ...formPrefill } : null),
    [formPrefill, venueId, venueCourts],
  );

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  return {
    canWrite,
    view,
    setView,
    // venue + day
    venueId,
    venueOptions,
    venueCourts,
    allCourts,
    optionsLoading,
    hasVenues: venues.length > 0,
    date,
    // apiData = { success, message, data: { date, hours, courts, bookings, games, closures } }
    day: dayData?.data || null,
    dayLoading,
    dayFetching,
    dayError,
    refetchDay,
    handleVenueChange,
    handleDateChange,
    handleShiftDate,
    handleToday,
    handleCellClick,
    // CR-038: the venue's TV court board
    displayUrl,
    isDisplayBusy: issueDisplayMutation.isPending || turnOffDisplayMutation.isPending,
    handleIssueDisplayLink,
    handleTurnOffDisplayLink,
    handleCopyDisplayLink,
    // list — apiData = { success, message, data: { bookings, stats, pagination } }
    bookings: listData?.data?.bookings || [],
    stats: listData?.data?.stats || { today: 0, unpaid: 0, noShowsThisWeek: 0, revenueToday: 0 },
    pagination: { ...pagination, total: listData?.data?.pagination?.total || 0 },
    filters,
    activeFilterCount,
    listLoading,
    listFetching,
    listError,
    refetchList,
    columns,
    handleFilterChange,
    handleClearFilters,
    handleTableChange,
    // drawer + detail
    formOpen,
    formEntity,
    handleNewBooking,
    handleFormClose,
    handleFormSuccess,
    detailBookingId,
    handleOpenDetail,
    handleCloseDetail,
  };
};
