import { useCallback, useMemo, useState } from "react";
import dayjs from "dayjs";
import { toast } from "sonner";
import { useNavigate } from "react-router";
import { Ban, Copy, Eye, ListOrdered, Pencil } from "lucide-react";

import RowActions from "../../../../components/RowActions";
import StatusDot from "../../../../components/StatusDot";
import { usePermissions } from "../../../../hooks/usePermissions";
import { confirm } from "../../../../store/confirmStore";
import { copyText } from "../../../../utils/clipboard";
import { decodeHTML } from "../../../../utils/decode-html";
import { formatPeso, formatTimeRange } from "../../../../utils/dynaCam";
import {
  useCancelPlaySession,
  useGetOpenPlayOptions,
  useGetPlaySeries,
  useGetPlaySessions,
  useStopPlaySeries,
} from "../../../../services/requests/admin/openPlay";

/** A session's state → its dot. */
export const PLAY_STATE_TONE = { Scheduled: "muted", Live: "success", Ended: "muted", Cancelled: "error" };

/** "Beginner – Intermediate", "Beginner and up", "All levels". */
export const levelRange = (min, max) => {
  if (min && max) return min === max ? min : `${min} – ${max}`;
  if (min) return `${min} and up`;
  if (max) return `Up to ${max}`;
  return "All levels";
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** [2, 4] → "Tue, Thu". */
export const dayNames = (days) => days.map((d) => DAY_NAMES[d]).join(", ");

/** "18:00" → "6 PM", "24:00" → "midnight". */
export const clockText = (hhmm) => {
  if (hhmm === "24:00") return "midnight";
  const t = dayjs(`2000-01-01 ${hhmm}`);
  return t.format(t.minute() ? "h:mm A" : "h A");
};

const EMPTY_FILTERS = { venueId: "", when: "upcoming" };

/**
 * PLAN-009 phase C — DGSports → Open Play: a company's drop-in sessions (upcoming
 * or past), the New / Edit session drawer, a session's spots, and its weekly series.
 */
export const useOpenPlayHooks = () => {
  const { hasPermission } = usePermissions();
  const navigate = useNavigate();
  const canWrite = hasPermission("open_play", null, "write");
  // Cancelling a session refunds its paid spots — a payments action
  const canRefund = canWrite && hasPermission("payments", null, "write");

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20 });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [detailId, setDetailId] = useState(null);

  const query = {
    venueId: filters.venueId || undefined,
    when: filters.when,
    page: pagination.current,
    pageSize: pagination.pageSize,
  };
  const { data, isLoading, isFetching, error, refetch } = useGetPlaySessions(query);
  const { data: optionsData } = useGetOpenPlayOptions();
  const { data: seriesData } = useGetPlaySeries(filters.venueId);
  const cancelMutation = useCancelPlaySession();
  const stopMutation = useStopPlaySeries();

  const venues = useMemo(() => optionsData?.data?.venues || [], [optionsData]);
  const venueOptions = useMemo(() => venues.map((v) => ({ value: v.venueId, label: decodeHTML(v.name) })), [venues]);
  const sessions = data?.data?.sessions || [];
  const total = data?.data?.pagination?.total || 0;
  const series = (seriesData?.data?.series || []).filter((s) => s.status === "Active");

  // ─── Handlers ──────────────────────────────────────────────────────
  const handleFilterChange = useCallback((key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPagination((prev) => ({ ...prev, current: 1 }));
  }, []);
  const handleTableChange = useCallback((next) => setPagination({ current: next.current, pageSize: next.pageSize }), []);

  const handleNew = useCallback(() => {
    setEditing(null);
    setFormOpen(true);
  }, []);
  const handleEdit = useCallback((record) => {
    setEditing(record);
    setFormOpen(true);
  }, []);
  const handleFormClose = useCallback(() => {
    setFormOpen(false);
    setEditing(null);
  }, []);

  const handleCopyLink = useCallback(async (record) => {
    const ok = await copyText(record.shareUrl);
    if (ok) toast.success("Link copied — share it with players");
    else toast.error("Couldn't copy the link");
  }, []);

  const handleCancel = useCallback(
    async (record) => {
      const paidNote = record.pricePerHead > 0 ? " Players who paid are refunded in full." : "";
      const ok = await confirm({
        title: "Cancel this session",
        description: `${decodeHTML(record.title)} on ${dayjs(record.startAt).format("ddd, MMM D")} — ${
          record.spotsTaken
        } player${record.spotsTaken === 1 ? "" : "s"} will be told it's cancelled.${paidNote} Its courts can be booked again.`,
        confirmText: "Cancel session",
        cancelText: "Keep it",
        danger: true,
      });
      if (ok) cancelMutation.mutate({ playSessionId: record.playSessionId });
    },
    [cancelMutation],
  );

  const handleStopSeries = useCallback(
    async (s) => {
      const ok = await confirm({
        title: "Stop this weekly series",
        description: `No more sessions of ${decodeHTML(s.title)} will be added. The ${s.upcomingSessions} already made stay — cancel them one by one if needed.`,
        confirmText: "Stop series",
        cancelText: "Keep it",
        danger: true,
      });
      if (ok) stopMutation.mutate(s.seriesId);
    },
    [stopMutation],
  );

  const getActionItems = useCallback(
    (record) => {
      const open = record.state === "Scheduled" || record.state === "Live";
      return [
        { key: "view", label: "Players", icon: <Eye className="w-4 h-4" />, onClick: () => setDetailId(record.playSessionId) },
        ...(open
          ? [
              {
                key: "queue",
                label: "Run the queue",
                icon: <ListOrdered className="w-4 h-4" />,
                onClick: () => navigate(`/admin/dyna-cam/open-play/${record.playSessionId}/queue`),
              },
            ]
          : []),
        { key: "copy", label: "Copy player link", icon: <Copy className="w-4 h-4" />, onClick: () => handleCopyLink(record) },
        ...(canWrite && open
          ? [{ key: "edit", label: "Edit", icon: <Pencil className="w-4 h-4" />, onClick: () => handleEdit(record) }]
          : []),
        ...(canRefund && open
          ? [
              { type: "divider" },
              { key: "cancel", label: "Cancel session", icon: <Ban className="w-4 h-4" />, danger: true, onClick: () => handleCancel(record) },
            ]
          : []),
      ];
    },
    [canWrite, canRefund, handleCopyLink, handleEdit, handleCancel, navigate],
  );

  // ─── Columns ───────────────────────────────────────────────────────
  const columns = useMemo(
    () => [
      {
        title: "When",
        key: "when",
        width: 190,
        render: (_, r) => (
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-dark)" }}>
              {dayjs(r.startAt).format("ddd, MMM D")}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>{formatTimeRange(r.startAt, r.endAt)}</div>
          </div>
        ),
      },
      {
        title: "Session",
        key: "title",
        render: (_, r) => (
          <button
            type="button"
            onClick={() => setDetailId(r.playSessionId)}
            className="min-w-0 text-left cursor-pointer hover:underline"
          >
            <div className="truncate" style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-dark)" }}>
              {decodeHTML(r.title)}
            </div>
            <div className="truncate" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
              {decodeHTML(r.venueName)} · {decodeHTML(r.courtNames || "")}
            </div>
          </button>
        ),
      },
      {
        title: "Level",
        key: "level",
        width: 200,
        render: (_, r) => (
          <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{levelRange(r.minLevel, r.maxLevel)}</span>
        ),
      },
      {
        title: "Players",
        key: "spots",
        width: 110,
        render: (_, r) => (
          <span className="font-mono" style={{ fontSize: 13, color: "var(--color-text-dark)" }}>
            {r.spotsTaken} / {r.capacity}
          </span>
        ),
      },
      {
        title: "Fee",
        key: "fee",
        width: 100,
        render: (_, r) => (
          <span style={{ fontSize: 13.5 }}>{r.pricePerHead > 0 ? formatPeso(r.pricePerHead) : "Free"}</span>
        ),
      },
      {
        title: "Status",
        key: "state",
        width: 130,
        render: (_, r) => <StatusDot tone={PLAY_STATE_TONE[r.state]}>{r.state}</StatusDot>,
      },
      {
        title: "",
        key: "actions",
        width: 56,
        render: (_, r) => <RowActions items={getActionItems(r)} />,
      },
    ],
    [getActionItems],
  );

  return {
    canWrite,
    filters,
    venueOptions,
    venues,
    sessions,
    columns,
    pagination: { ...pagination, total },
    series,
    isLoading,
    isFetching,
    error,
    refetch,
    handleFilterChange,
    handleTableChange,
    formOpen,
    editing,
    handleNew,
    handleFormClose,
    detailId,
    handleCloseDetail: () => setDetailId(null),
    handleStopSeries,
  };
};
