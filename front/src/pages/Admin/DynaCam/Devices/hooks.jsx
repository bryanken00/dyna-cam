import { useState, useCallback, useMemo } from "react";
import { Ban, KeyRound, Pencil, Trash2 } from "lucide-react";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import RowActions from "../../../../components/RowActions";
import StatusDot from "../../../../components/StatusDot";
import { useDebounce } from "../../../../hooks/useDebounce";
import { usePermissions } from "../../../../hooks/usePermissions";
import { decodeHTML } from "../../../../utils/decode-html";
import { formatDateTime } from "../../../../utils/dynaCam";
import { confirm } from "../../../../store/confirmStore";
import {
  useGetDevices,
  useGetDeviceOptions,
  useReissueDeviceToken,
  useRevokeDevice,
  useDeleteDevice,
} from "../../../../services/requests/admin/devices";

dayjs.extend(relativeTime);

/**
 * "Seen 2 minutes ago" from the server-computed `lastSeenSecondsAgo`, so the
 * browser's clock and time zone don't matter. null → never connected.
 */
const lastSeenLabel = (secondsAgo) => {
  if (secondsAgo === null || secondsAgo === undefined) return "Never connected";
  const seconds = Math.max(0, Number(secondsAgo) || 0);
  if (seconds < 45) return "Seen just now";
  return `Seen ${dayjs().subtract(seconds, "second").fromNow()}`;
};

/** Heartbeat camera status → dot tone + label. */
const CAMERA_STATE = {
  ok: { tone: "success", label: "Recording" },
  starting: { tone: "warning", label: "Starting" },
  error: { tone: "error", label: "Error" },
};

const DEVICE_STATUS_TONE = {
  Active: "success",
  Revoked: "error",
  Deleted: "muted",
};

export const useDeviceHooks = () => {
  const { hasPermission } = usePermissions();
  const canWrite = hasPermission("venues", "devices", "write");

  const [pagination, setPagination] = useState({ current: 1, pageSize: 10 });
  const [filters, setFilters] = useState({
    search: "",
    venueId: "",
    status: "",
  });
  const debouncedSearch = useDebounce(filters.search, 500);

  // ─── Drawer / Dialog State ─────────────────────────────────────────
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState(null);
  // { deviceName, token } — the one-time token to show, or null
  const [issuedToken, setIssuedToken] = useState(null);

  // ─── API Hooks ─────────────────────────────────────────────────────
  const {
    data: apiData,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useGetDevices({
    page: pagination.current,
    pageSize: pagination.pageSize,
    search: debouncedSearch,
    venueId: filters.venueId,
    status: filters.status,
  });

  // Venue filter options — under this page's own permission
  const { data: optionsData } = useGetDeviceOptions();

  const reissueMutation = useReissueDeviceToken();
  const revokeMutation = useRevokeDevice();
  const deleteMutation = useDeleteDevice();

  const venueOptions = useMemo(
    () =>
      (optionsData?.data?.venues || []).map((v) => ({
        value: v.venueId,
        label: decodeHTML(v.name),
        hint: v.status === "Active" ? undefined : v.status,
      })),
    [optionsData],
  );

  // ─── Handlers ──────────────────────────────────────────────────────
  const handleTableChange = useCallback((next) => {
    setPagination({ current: next.current, pageSize: next.pageSize });
  }, []);

  const handleSearch = useCallback((value) => {
    setFilters((prev) => ({ ...prev, search: value }));
    setPagination((prev) => ({ ...prev, current: 1 }));
  }, []);

  const handleVenueFilter = useCallback((value) => {
    setFilters((prev) => ({ ...prev, venueId: value }));
    setPagination((prev) => ({ ...prev, current: 1 }));
  }, []);

  const handleStatusFilter = useCallback((value) => {
    setFilters((prev) => ({ ...prev, status: value }));
    setPagination((prev) => ({ ...prev, current: 1 }));
  }, []);

  const handleClearFilters = useCallback(() => {
    setFilters({ search: "", venueId: "", status: "" });
    setPagination((prev) => ({ ...prev, current: 1 }));
  }, []);

  const handleCreate = useCallback(() => {
    setSelectedDevice(null);
    setDrawerOpen(true);
  }, []);

  const handleEdit = useCallback((record) => {
    setSelectedDevice(record);
    setDrawerOpen(true);
  }, []);

  const handleDrawerClose = useCallback(() => {
    setDrawerOpen(false);
    setSelectedDevice(null);
  }, []);

  // The drawer hands back the create response; a new box carries its token,
  // which is shown once in the token dialog.
  const handleDrawerSuccess = useCallback((result) => {
    setDrawerOpen(false);
    setSelectedDevice(null);
    if (result?.token) {
      setIssuedToken({ deviceName: result.name, token: result.token });
    }
  }, []);

  const handleTokenDialogClose = useCallback(() => {
    setIssuedToken(null);
  }, []);

  const handleReissueRequest = useCallback(
    async (record) => {
      const name = decodeHTML(record.name);
      const revoked = record.status === "Revoked";
      const ok = await confirm({
        title: revoked ? "Re-activate recorder box" : "Issue a new token",
        description: revoked
          ? `Issue a new token for "${name}" and let it connect again? Put the new token in the box's settings.`
          : `Issue a new token for "${name}"? Its current token stops working right away, so the box goes offline until you put the new token in its settings.`,
        confirmText: "Issue new token",
        cancelText: "Cancel",
        danger: !revoked,
      });
      if (!ok) return;
      try {
        const response = await reissueMutation.mutateAsync(record.deviceId);
        const token = response?.data?.token;
        if (token) setIssuedToken({ deviceName: name, token });
      } catch (err) {
        // the mutation's onError already surfaced a toast
        console.error("Reissue token error:", err);
      }
    },
    [reissueMutation],
  );

  const handleRevokeRequest = useCallback(
    async (record) => {
      const ok = await confirm({
        title: "Revoke recorder box",
        description: `Revoke "${decodeHTML(
          record.name,
        )}"? It is refused from its next request and stops recording. You can re-activate it later by issuing a new token.`,
        confirmText: "Revoke",
        cancelText: "Cancel",
        danger: true,
      });
      if (ok) revokeMutation.mutate(record.deviceId);
    },
    [revokeMutation],
  );

  const handleDeleteRequest = useCallback(
    async (record) => {
      const ok = await confirm({
        title: "Delete recorder box",
        description: `Delete "${decodeHTML(
          record.name,
        )}"? It stops recording right away. This can't be undone.`,
        confirmText: "Delete",
        cancelText: "Cancel",
        danger: true,
      });
      if (ok) deleteMutation.mutate(record.deviceId);
    },
    [deleteMutation],
  );

  // ⋮ menu: Rename, Issue new token, Revoke, divider, Delete (danger)
  const getActionItems = useCallback(
    (record) => {
      if (!canWrite || record.status === "Deleted") return [];
      const revoked = record.status === "Revoked";
      const items = [
        {
          key: "edit",
          label: "Rename",
          icon: <Pencil className="w-4 h-4" />,
          onClick: () => handleEdit(record),
        },
        {
          key: "token",
          label: revoked ? "Re-activate with new token" : "Issue new token",
          icon: <KeyRound className="w-4 h-4" />,
          onClick: () => handleReissueRequest(record),
        },
      ];
      if (!revoked) {
        items.push({
          key: "revoke",
          label: "Revoke",
          icon: <Ban className="w-4 h-4" />,
          onClick: () => handleRevokeRequest(record),
        });
      }
      items.push(
        { type: "divider" },
        {
          key: "delete",
          label: "Delete",
          icon: <Trash2 className="w-4 h-4" />,
          danger: true,
          onClick: () => handleDeleteRequest(record),
        },
      );
      return items;
    },
    [
      canWrite,
      handleEdit,
      handleReissueRequest,
      handleRevokeRequest,
      handleDeleteRequest,
    ],
  );

  const { current, pageSize } = pagination;

  // ─── Columns ───────────────────────────────────────────────────────
  // # · box + venue · connection · agent · cameras · status · ⋮
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
        title: "Recorder box",
        dataIndex: "name",
        key: "name",
        render: (_, record) => {
          const label = decodeHTML(record.name) || "";
          const initial = (label.trim().charAt(0) || "?").toUpperCase();
          return (
            <div className="flex items-center gap-3 min-w-0">
              <span
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  background: "var(--color-surface-sunken)",
                  border: "1px solid var(--color-line)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flex: "none",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--color-text-secondary)",
                }}
              >
                {initial}
              </span>
              <div className="min-w-0">
                <div
                  className="truncate"
                  style={{
                    fontSize: 14,
                    fontWeight: 500,
                    color: "var(--color-text-dark)",
                  }}
                >
                  {label}
                </div>
                <div
                  className="truncate"
                  style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}
                >
                  {decodeHTML(record.venueName)}
                </div>
              </div>
            </div>
          );
        },
      },
      {
        title: "Connection",
        key: "online",
        width: 170,
        render: (_, record) => (
          <div>
            <StatusDot tone={record.online ? "success" : "muted"}>
              {record.online ? "Online" : "Offline"}
            </StatusDot>
            <div
              className="mt-0.5"
              style={{ fontSize: 12, color: "var(--color-text-muted)" }}
              title={record.lastSeenAt ? formatDateTime(record.lastSeenAt) : undefined}
            >
              {lastSeenLabel(record.lastSeenSecondsAgo)}
            </div>
          </div>
        ),
      },
      {
        title: "Agent",
        dataIndex: "agentVersion",
        key: "agentVersion",
        width: 100,
        render: (version) => (
          <span
            className="font-mono"
            style={{ fontSize: 12, color: "var(--color-text-secondary)" }}
          >
            {version || "-"}
          </span>
        ),
      },
      {
        title: "Cameras",
        dataIndex: "cameras",
        key: "cameras",
        width: 230,
        render: (cameras, record) => {
          if (!cameras?.length) {
            return (
              <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
                No report yet
              </span>
            );
          }
          // An offline box's report is stale — show it, but dimmed
          return (
            <div
              className="flex flex-col gap-1"
              style={{ opacity: record.online ? 1 : 0.6 }}
              title={record.online ? undefined : "Last report before the box went offline"}
            >
              {cameras.map((cam) => {
                const state = CAMERA_STATE[cam.status] || {
                  tone: "muted",
                  label: cam.status,
                };
                return (
                  <StatusDot
                    key={cam.courtId}
                    tone={state.tone}
                    title={cam.message || undefined}
                  >
                    <span className="truncate">
                      {decodeHTML(cam.courtName)}
                      <span style={{ color: "var(--color-text-muted)" }}>
                        {" · "}
                        {state.label}
                      </span>
                    </span>
                  </StatusDot>
                );
              })}
            </div>
          );
        },
      },
      {
        title: "Status",
        dataIndex: "status",
        key: "status",
        width: 110,
        render: (status) => (
          <StatusDot tone={DEVICE_STATUS_TONE[status] || "muted"}>
            {status}
          </StatusDot>
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

  const devices = apiData?.data?.devices || [];

  return {
    // apiData = { success, message, data: { devices, pagination } }
    data: devices,
    pagination: { ...pagination, total: apiData?.data?.pagination?.total || 0 },
    filters,
    isLoading,
    isFetching,
    error,
    refetch,
    canWrite,
    venueOptions,
    columns,
    handleTableChange,
    handleSearch,
    handleVenueFilter,
    handleStatusFilter,
    handleClearFilters,
    drawerOpen,
    selectedDevice,
    handleCreate,
    handleDrawerClose,
    handleDrawerSuccess,
    issuedToken,
    handleTokenDialogClose,
  };
};
