import { useState, useCallback, useMemo } from "react";
import { toast } from "sonner";
import dayjs from "dayjs";
import {
  Ban,
  Copy,
  Eye,
  ExternalLink,
  Smartphone,
  Square,
  TimerReset,
} from "lucide-react";
import PaymentStatusChip from "../../../../components/PaymentStatusChip";
import RowActions from "../../../../components/RowActions";
import StatusDot from "../../../../components/StatusDot";
import VideosProgress from "./components/VideosProgress";
import DevicesCount from "./components/DevicesCount";
import { useDebounce } from "../../../../hooks/useDebounce";
import { usePermissions } from "../../../../hooks/usePermissions";
import { decodeHTML } from "../../../../utils/decode-html";
import { copyText } from "../../../../utils/clipboard";
import { formatPhoneDisplay } from "../../../../utils/phoneFormat";
import {
  LONG_GAME_MINUTES,
  SESSION_STATUS_TONE,
  formatDate,
  formatMinutes,
  formatPayCode,
  formatTimeRange,
} from "../../../../utils/dynaCam";
import { confirm } from "../../../../store/confirmStore";
import { useGetClipOptions } from "../../../../services/requests/admin/clips";
import {
  useGetSessions,
  useCancelSession,
  useEndSession,
} from "../../../../services/requests/admin/sessions";

const EMPTY_FILTERS = { search: "", venueId: "", courtId: "", status: "" };

/** A device can be paired to a session until it ends (CR-005: a waiting game too — it starts it). */
const PAIRABLE_STATUSES = ["Waiting", "Scheduled", "Recording"];

/** Can it still be cancelled? Before it records: a waiting game, or a booking not yet started. */
const CANCELLABLE_STATUSES = ["Waiting", "Scheduled"];

export const useSessionHooks = () => {
  const { hasPermission } = usePermissions();
  // Sessions deliver their footage as clips — same permission
  const canWrite = hasPermission("clips", null, "write");

  const [pagination, setPagination] = useState({ current: 1, pageSize: 20 });
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const debouncedSearch = useDebounce(filters.search, 500);

  // ─── Drawer / Dialog / Sheet State ─────────────────────────────────
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detailSessionId, setDetailSessionId] = useState(null);
  // The session a device is being named for: { sessionId, courtName, venueName, startAt, endAt }
  const [pairTarget, setPairTarget] = useState(null);
  // { code, name, courtName, expiresInSeconds, receivedAt } — a new key, or null
  const [pairingKey, setPairingKey] = useState(null);
  // CR-016: the recording game time is being added to, or null
  const [addTimeTarget, setAddTimeTarget] = useState(null);

  // ─── API Hooks ─────────────────────────────────────────────────────
  const {
    data: apiData,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useGetSessions({
    page: pagination.current,
    pageSize: pagination.pageSize,
    search: debouncedSearch,
    venueId: filters.venueId,
    courtId: filters.courtId,
    status: filters.status,
  });

  // Venue + court filter options — under the clips permission
  const { data: optionsData } = useGetClipOptions();
  const cancelMutation = useCancelSession();
  const endMutation = useEndSession();

  const venueOptions = useMemo(
    () =>
      (optionsData?.data?.venues || []).map((v) => ({
        value: v.venueId,
        label: decodeHTML(v.name),
      })),
    [optionsData],
  );

  const courtOptions = useMemo(
    () =>
      (optionsData?.data?.courts || [])
        .filter((c) => !filters.venueId || c.venueId === filters.venueId)
        .map((c) => ({
          value: c.courtId,
          label: decodeHTML(c.name),
          hint: filters.venueId ? undefined : decodeHTML(c.venueName),
        })),
    [optionsData, filters.venueId],
  );

  // ─── Handlers ──────────────────────────────────────────────────────
  const handleTableChange = useCallback((next) => {
    setPagination({ current: next.current, pageSize: next.pageSize });
  }, []);

  const handleFilterChange = useCallback((key, value) => {
    setFilters((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "venueId") next.courtId = "";
      return next;
    });
    setPagination((prev) => ({ ...prev, current: 1 }));
  }, []);

  const handleSearch = useCallback(
    (value) => handleFilterChange("search", value),
    [handleFilterChange],
  );

  const handleClearFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setPagination((prev) => ({ ...prev, current: 1 }));
  }, []);

  const handleCreate = useCallback(() => setDrawerOpen(true), []);
  const handleDrawerClose = useCallback(() => setDrawerOpen(false), []);

  // The drawer hands back the booking — go straight on to pairing a device
  const handleDrawerSuccess = useCallback((booked) => {
    setDrawerOpen(false);
    if (booked?.sessionId) setPairTarget(booked);
  }, []);

  // ─── Pair a device: name it → its 6-digit key ──────────────────────
  const handlePairDevice = useCallback((session) => {
    setPairTarget({
      sessionId: session.sessionId,
      courtName: session.courtName,
      venueName: session.venueName,
      startAt: session.startAt,
      endAt: session.endAt,
    });
  }, []);
  const handlePairFormClose = useCallback(() => setPairTarget(null), []);
  const handlePairFormSuccess = useCallback((key) => {
    setPairTarget(null);
    if (key?.code) setPairingKey({ ...key, receivedAt: Date.now() });
  }, []);
  const handlePairingKeyClose = useCallback(() => setPairingKey(null), []);

  // ─── CR-016: Add time to a recording game ──────────────────────────
  const handleAddTime = useCallback((record) => setAddTimeTarget(record), []);
  const handleAddTimeClose = useCallback(() => setAddTimeTarget(null), []);

  const handleView = useCallback((record) => {
    setDetailSessionId(record.sessionId);
  }, []);
  const handleDetailClose = useCallback(() => setDetailSessionId(null), []);

  const handleCopyLink = useCallback(async (record) => {
    const ok = await copyText(record.shareUrl);
    if (ok) toast.success("Player link copied");
    else toast.error("Couldn't copy the link");
  }, []);

  const handleOpenLink = useCallback((record) => {
    window.open(record.shareUrl, "_blank", "noopener");
  }, []);

  const handleCancelRequest = useCallback(
    async (record) => {
      const when =
        record.startAt && record.endAt
          ? ` (${formatDate(record.startAt)}, ${formatTimeRange(record.startAt, record.endAt)})`
          : "";
      const ok = await confirm({
        title: record.status === "Waiting" ? "Cancel game" : "Cancel session",
        description: `Cancel the ${record.status === "Waiting" ? "game" : "session"} on ${decodeHTML(
          record.courtName,
        )}${when}? Nothing will be recorded and its player link stops working.`,
        confirmText: record.status === "Waiting" ? "Cancel game" : "Cancel session",
        cancelText: "Keep it",
        danger: true,
      });
      if (ok) cancelMutation.mutate(record.sessionId);
    },
    [cancelMutation],
  );

  const handleEndRequest = useCallback(
    async (record) => {
      const ok = await confirm({
        title: "End game",
        description: `Stop recording ${decodeHTML(
          record.courtName,
        )} now? The game so far is saved and sent to the player link.`,
        confirmText: "End game",
        cancelText: "Keep recording",
        danger: true,
      });
      if (ok) endMutation.mutate(record.sessionId);
    },
    [endMutation],
  );

  // ⋮ menu: View, link actions, divider, End now / Cancel
  const getActionItems = useCallback(
    (record) => {
      const items = [
        {
          key: "view",
          label: "View details",
          icon: <Eye className="w-4 h-4" />,
          onClick: () => handleView(record),
        },
      ];
      if (record.status !== "Cancelled") {
        items.push(
          {
            key: "copy",
            label: "Copy player link",
            icon: <Copy className="w-4 h-4" />,
            onClick: () => handleCopyLink(record),
          },
          {
            key: "open",
            label: "Open player page",
            icon: <ExternalLink className="w-4 h-4" />,
            onClick: () => handleOpenLink(record),
          },
        );
      }
      if (canWrite && PAIRABLE_STATUSES.includes(record.status)) {
        items.push({
          key: "pair",
          label: "Pair a device",
          icon: <Smartphone className="w-4 h-4" />,
          onClick: () => handlePairDevice(record),
        });
      }
      // CR-016: a game with a game time (not an open game) can get more time
      if (canWrite && record.status === "Recording" && record.endAt) {
        items.push({
          key: "addTime",
          label: "Add time",
          icon: <TimerReset className="w-4 h-4" />,
          onClick: () => handleAddTime(record),
        });
      }
      if (canWrite && record.status === "Recording") {
        items.push(
          { type: "divider" },
          {
            key: "end",
            label: "End game",
            icon: <Square className="w-4 h-4" />,
            danger: true,
            onClick: () => handleEndRequest(record),
          },
        );
      }
      if (canWrite && CANCELLABLE_STATUSES.includes(record.status)) {
        items.push(
          { type: "divider" },
          {
            key: "cancel",
            label: record.status === "Waiting" ? "Cancel game" : "Cancel session",
            icon: <Ban className="w-4 h-4" />,
            danger: true,
            onClick: () => handleCancelRequest(record),
          },
        );
      }
      return items;
    },
    [
      canWrite,
      handleView,
      handleCopyLink,
      handleOpenLink,
      handlePairDevice,
      handleAddTime,
      handleEndRequest,
      handleCancelRequest,
    ],
  );

  const { current, pageSize } = pagination;

  // ─── Columns ───────────────────────────────────────────────────────
  // # · court + venue · when · player · status (+ paired devices) · videos · ⋮
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
        title: "Court",
        dataIndex: "courtName",
        key: "courtName",
        render: (_, record) => (
          <div className="min-w-0">
            <div
              className="truncate"
              style={{
                fontSize: 14,
                fontWeight: 500,
                color: "var(--color-text-dark)",
              }}
            >
              {decodeHTML(record.courtName)}
            </div>
            <div
              className="truncate"
              style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}
            >
              {decodeHTML(record.venueName)}
            </div>
          </div>
        ),
      },
      {
        title: "When",
        dataIndex: "startAt",
        key: "startAt",
        width: 200,
        render: (startAt, record) => {
          // CR-005: a game waits for its device, then records with no end time
          if (record.status === "Waiting") {
            return (
              <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
                Waiting for a device
              </span>
            );
          }
          if (!record.endAt) {
            const long = record.durationMinutes >= LONG_GAME_MINUTES;
            return (
              <div>
                <div style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}>
                  {formatDate(startAt)}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: long ? "var(--color-warning)" : "var(--color-text-muted)",
                    fontWeight: long ? 600 : undefined,
                  }}
                  title={long ? "Recording a long time — did they forget End game?" : undefined}
                >
                  Since {dayjs(startAt).format("h:mm A")} ·{" "}
                  {formatMinutes(record.durationMinutes)} so far
                </div>
              </div>
            );
          }
          return (
            <div>
              <div style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}>
                {formatDate(startAt)}
              </div>
              <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                {formatTimeRange(startAt, record.endAt)} ·{" "}
                {formatMinutes(record.durationMinutes)}
              </div>
              {/* CR-016: a recording game stops by itself; time staff added */}
              {(record.status === "Recording" || record.addedMinutes > 0) && (
                <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                  {record.status === "Recording"
                    ? `Stops at ${dayjs(record.endAt).format("h:mm A")}`
                    : ""}
                  {record.status === "Recording" && record.addedMinutes > 0 ? " · " : ""}
                  {record.addedMinutes > 0
                    ? `+${formatMinutes(record.addedMinutes)} added`
                    : ""}
                </div>
              )}
            </div>
          );
        },
      },
      {
        title: "Player",
        dataIndex: "playerName",
        key: "playerName",
        width: 170,
        render: (name, record) => (
          <div className="min-w-0">
            <div
              className="truncate"
              style={{
                fontSize: 13.5,
                color: name
                  ? "var(--color-text-secondary)"
                  : "var(--color-text-muted)",
              }}
            >
              {decodeHTML(name) || "—"}
            </div>
            {record.phone && (
              <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                {formatPhoneDisplay(record.phone)}
              </div>
            )}
            {record.startedBy && (
              <div
                className="truncate"
                style={{ fontSize: 12, color: "var(--color-text-muted)" }}
              >
                Started by {decodeHTML(record.startedBy)}
              </div>
            )}
          </div>
        ),
      },
      {
        title: "Status",
        dataIndex: "status",
        key: "status",
        width: 150,
        render: (status, record) => (
          <div className="min-w-0">
            <StatusDot tone={SESSION_STATUS_TONE[status] || "muted"}>
              {status}
            </StatusDot>
            {status === "Failed" && record.failureReason && (
              <div
                className="truncate mt-0.5"
                style={{ fontSize: 12, color: "var(--color-text-muted)" }}
                title={record.failureReason}
              >
                {record.failureReason}
              </div>
            )}
            <DevicesCount
              count={Number(record.devicesCount) || 0}
              live={PAIRABLE_STATUSES.includes(status)}
            />
          </div>
        ),
      },
      {
        // CR-015: Unpaid (with the code the device shows) until paid at the desk
        title: "Payment",
        key: "payment",
        width: 140,
        render: (_, record) => (
          <div className="min-w-0">
            <PaymentStatusChip
              paymentStatus={record.paymentStatus}
              price={record.paidAmount}
            />
            {record.paymentStatus === "Unpaid" && record.payCode && (
              <div
                className="font-mono mt-0.5"
                style={{
                  fontSize: 12,
                  letterSpacing: "0.06em",
                  color: "var(--color-text-muted)",
                }}
              >
                {formatPayCode(record.payCode)}
              </div>
            )}
          </div>
        ),
      },
      {
        title: "Footage",
        key: "videos",
        width: 120,
        render: (_, record) => (
          <VideosProgress
            ready={Number(record.videosReady) || 0}
            total={Number(record.videosTotal) || 0}
            status={record.status}
          />
        ),
      },
      {
        title: "",
        key: "actions",
        width: 60,
        align: "right",
        render: (_, record) => <RowActions items={getActionItems(record)} />,
      },
    ],
    [getActionItems, current, pageSize],
  );

  const sessions = apiData?.data?.sessions || [];

  return {
    // apiData = { success, message, data: { sessions, pagination } }
    data: sessions,
    pagination: { ...pagination, total: apiData?.data?.pagination?.total || 0 },
    filters,
    isLoading,
    isFetching,
    error,
    refetch,
    canWrite,
    venueOptions,
    courtOptions,
    columns,
    handleTableChange,
    handleSearch,
    handleFilterChange,
    handleClearFilters,
    drawerOpen,
    handleCreate,
    handleDrawerClose,
    handleDrawerSuccess,
    detailSessionId,
    handleDetailClose,
    pairTarget,
    handlePairDevice,
    handlePairFormClose,
    handlePairFormSuccess,
    pairingKey,
    handlePairingKeyClose,
    addTimeTarget,
    handleAddTimeClose,
  };
};
