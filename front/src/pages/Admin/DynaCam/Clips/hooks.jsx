import { useState, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { Cloud, Copy, ExternalLink, Film, Play } from "lucide-react";
import RowActions from "../../../../components/RowActions";
import StatusDot from "../../../../components/StatusDot";
import PaymentStatusChip from "../../../../components/PaymentStatusChip";
import SourceChip from "./components/SourceChip";
import { usePermissions } from "../../../../hooks/usePermissions";
import { decodeHTML } from "../../../../utils/decode-html";
import { copyText } from "../../../../utils/clipboard";
import { getImageUrl } from "../../../../utils/upload";
import {
  CLIP_DRIVE_LABEL,
  CLIP_STATUS_TONE,
  formatBytes,
  formatDate,
  formatDateTime,
  formatDuration,
  formatPayCode,
  formatPeso,
} from "../../../../utils/dynaCam";
import { confirm } from "../../../../store/confirmStore";
import {
  useGetClips,
  useGetClipOptions,
} from "../../../../services/requests/admin/clips";
import { useCreatePayment } from "../../../../services/requests/admin/payments";

const EMPTY_FILTERS = {
  venueId: "",
  courtId: "",
  source: "",
  status: "",
  paymentStatus: "",
  dateFrom: "",
  dateTo: "",
};

// Clips are view only (PLAN-002 Phase E): staff don't save or delete them
// here — players save them from the court, and sessions deliver their parts.
export const useClipHooks = () => {
  const { hasPermission } = usePermissions();
  // Taking cash for an unpaid clip is a Payments action
  const canTakePayment = hasPermission("payments", null, "write");

  const [pagination, setPagination] = useState({ current: 1, pageSize: 20 });
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  // ─── Preview Sheet State ───────────────────────────────────────────
  const [previewClip, setPreviewClip] = useState(null);

  // ─── API Hooks ─────────────────────────────────────────────────────
  const {
    data: apiData,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useGetClips({
    page: pagination.current,
    pageSize: pagination.pageSize,
    ...filters,
  });

  // Venue + court filter options — under the clips permission
  const { data: optionsData } = useGetClipOptions();

  const paymentMutation = useCreatePayment();

  const venueOptions = useMemo(
    () =>
      (optionsData?.data?.venues || []).map((v) => ({
        value: v.venueId,
        label: decodeHTML(v.name),
      })),
    [optionsData],
  );

  // Courts of the chosen venue (all courts when no venue is picked)
  const courtOptions = useMemo(
    () =>
      (optionsData?.data?.courts || [])
        .filter((c) => !filters.venueId || c.venueId === filters.venueId)
        .map((c) => ({
          value: c.courtId,
          label: decodeHTML(c.name),
          // Several venues can each have a "Court 1"
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
      // A court belongs to one venue — a new venue clears the court pick
      if (key === "venueId") next.courtId = "";
      return next;
    });
    setPagination((prev) => ({ ...prev, current: 1 }));
  }, []);

  const handleClearFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setPagination((prev) => ({ ...prev, current: 1 }));
  }, []);

  const handlePreview = useCallback((record) => {
    setPreviewClip(record);
  }, []);

  const handlePreviewClose = useCallback(() => {
    setPreviewClip(null);
  }, []);

  const handleCopyShareLink = useCallback(async (record) => {
    const ok = await copyText(record.shareUrl);
    if (ok) toast.success("Share link copied");
    else toast.error("Couldn't copy the link");
  }, []);

  const handleOpenSharePage = useCallback((record) => {
    window.open(record.shareUrl, "_blank", "noopener");
  }, []);

  const handleRecordPayment = useCallback(
    async (record) => {
      const ok = await confirm({
        title: "Record cash payment",
        description: `Record ${formatPeso(record.price)} cash for this clip from ${decodeHTML(
          record.courtName,
        )}${record.payCode ? ` (pay code ${formatPayCode(record.payCode)})` : ""}? The player's clip unlocks right away.`,
        confirmText: `Record ${formatPeso(record.price)}`,
        cancelText: "Cancel",
      });
      if (!ok) return;
      try {
        await paymentMutation.mutateAsync({ clipId: record.clipId });
      } catch (err) {
        // the mutation's onError already surfaced a toast
        console.error("Record payment error:", err);
      }
    },
    [paymentMutation],
  );

  // ⋮ menu: Preview, share-link actions (view only)
  const getActionItems = useCallback(
    (record) => {
      if (record.status === "Deleted") return [];
      const items = [];
      if (record.status === "Ready") {
        items.push({
          key: "preview",
          label: "Preview",
          icon: <Play className="w-4 h-4" />,
          onClick: () => handlePreview(record),
        });
      }
      items.push(
        {
          key: "copy",
          label: "Copy share link",
          icon: <Copy className="w-4 h-4" />,
          onClick: () => handleCopyShareLink(record),
        },
        {
          key: "open",
          label: "Open share page",
          icon: <ExternalLink className="w-4 h-4" />,
          onClick: () => handleOpenSharePage(record),
        },
      );
      // CR-001: the copy in the court's Google Drive
      if (record.driveUrl) {
        items.push({
          key: "drive",
          label: "Open in Google Drive",
          icon: <Cloud className="w-4 h-4" />,
          onClick: () => window.open(record.driveUrl, "_blank", "noopener,noreferrer"),
        });
      }
      return items;
    },
    [handlePreview, handleCopyShareLink, handleOpenSharePage],
  );

  const { current, pageSize } = pagination;

  // ─── Columns ───────────────────────────────────────────────────────
  // # · thumbnail · court + venue · requested + source · length · status ·
  // expires · size · ⋮
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
        title: "Clip",
        key: "thumbnail",
        width: 104,
        render: (_, record) => {
          const ready = record.status === "Ready" && record.thumbnailUrl;
          return (
            <button
              type="button"
              disabled={!ready}
              onClick={() => handlePreview(record)}
              aria-label={ready ? "Preview clip" : undefined}
              className="relative overflow-hidden flex items-center justify-center group disabled:cursor-default cursor-pointer"
              style={{
                width: 80,
                height: 45,
                borderRadius: 6,
                border: "1px solid var(--color-line)",
                background: "var(--color-surface-sunken)",
                color: "var(--color-text-muted)",
              }}
            >
              {ready ? (
                <>
                  <img
                    src={getImageUrl(record.thumbnailUrl)}
                    alt=""
                    className="w-full h-full object-cover"
                    width={80}
                    height={45}
                    loading="lazy"
                    decoding="async"
                  />
                  <Play
                    className="absolute w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ color: "var(--color-text-color)" }}
                    fill="currentColor"
                  />
                </>
              ) : (
                <Film className="w-4 h-4" strokeWidth={1.6} />
              )}
            </button>
          );
        },
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
        title: "Requested",
        dataIndex: "requestedAt",
        key: "requestedAt",
        width: 180,
        render: (requestedAt) => (
          <span style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}>
            {formatDateTime(requestedAt)}
          </span>
        ),
      },
      {
        title: "Source",
        dataIndex: "source",
        key: "source",
        width: 140,
        render: (source, record) => (
          <SourceChip
            source={source}
            partIndex={record.partIndex}
            pairedAppName={record.pairedAppName}
          />
        ),
      },
      {
        title: "Length",
        dataIndex: "durationSeconds",
        key: "durationSeconds",
        width: 80,
        render: (seconds) => (
          <span
            className="font-mono"
            style={{ fontSize: 12.5, color: "var(--color-text-secondary)" }}
          >
            {formatDuration(seconds)}
          </span>
        ),
      },
      {
        title: "Status",
        dataIndex: "status",
        key: "status",
        width: 170,
        render: (status, record) => (
          <div className="min-w-0">
            <StatusDot tone={CLIP_STATUS_TONE[status] || "muted"}>
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
            {record.driveStatus && (
              <div
                className="inline-flex items-center gap-1 truncate mt-0.5"
                style={{ fontSize: 12, color: "var(--color-text-muted)" }}
                title={record.driveError || undefined}
              >
                <Cloud className="w-3 h-3 shrink-0" />
                {CLIP_DRIVE_LABEL[record.driveStatus] || record.driveStatus}
              </div>
            )}
          </div>
        ),
      },
      {
        title: "Payment",
        dataIndex: "paymentStatus",
        key: "paymentStatus",
        width: 140,
        render: (paymentStatus, record) => (
          <PaymentStatusChip paymentStatus={paymentStatus} price={record.price} />
        ),
      },
      {
        title: "Expires",
        dataIndex: "expiresAt",
        key: "expiresAt",
        width: 120,
        render: (expiresAt) => (
          <span style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}>
            {formatDate(expiresAt)}
          </span>
        ),
      },
      {
        title: "Size",
        dataIndex: "sizeBytes",
        key: "sizeBytes",
        width: 90,
        render: (bytes) => (
          <span style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}>
            {formatBytes(bytes)}
          </span>
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
    [getActionItems, handlePreview, current, pageSize],
  );

  const clips = apiData?.data?.clips || [];
  const currentPreview = previewClip
    ? clips.find((c) => c.clipId === previewClip.clipId) || previewClip
    : null;

  return {
    // apiData = { success, message, data: { clips, pagination } }
    data: clips,
    pagination: { ...pagination, total: apiData?.data?.pagination?.total || 0 },
    filters,
    isLoading,
    isFetching,
    error,
    refetch,
    venueOptions,
    courtOptions,
    columns,
    handleTableChange,
    handleFilterChange,
    handleClearFilters,
    previewClip: currentPreview,
    handlePreviewClose,
    canTakePayment,
    handleRecordPayment,
    isRecordingPayment: paymentMutation.isPending,
    handleCopyShareLink,
  };
};
