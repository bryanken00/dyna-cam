import { useState, useCallback, useMemo } from "react";
import { Pencil, Trash2, Unlink } from "lucide-react";
import RowActions from "../../../../components/RowActions";
import StatusDot from "../../../../components/StatusDot";
import { usePermissions } from "../../../../hooks/usePermissions";
import { decodeHTML } from "../../../../utils/decode-html";
import { formatAgo, formatDateTime } from "../../../../utils/dynaCam";
import { confirm } from "../../../../store/confirmStore";
import {
  useGetPairedApps,
  useGetPairedAppOptions,
  useRevokePairedApp,
  useDeletePairedApp,
} from "../../../../services/requests/admin/paired-apps";

const STATUS_TONE = { Active: "success", Revoked: "error", Deleted: "muted" };

/** A phone counts as "in use" if it talked to the API in the last 5 minutes. */
const RECENT_SECONDS = 5 * 60;

export const usePairedAppHooks = () => {
  const { hasPermission } = usePermissions();
  const canWrite = hasPermission("paired_apps", null, "write");

  const [pagination, setPagination] = useState({ current: 1, pageSize: 20 });
  const [filters, setFilters] = useState({ venueId: "", status: "" });

  // ─── Drawer / Dialog State ─────────────────────────────────────────
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedApp, setSelectedApp] = useState(null);
  // { code, name, venueName, receivedAt } — a new phone's key, or null
  const [pairingKey, setPairingKey] = useState(null);

  // ─── API Hooks ─────────────────────────────────────────────────────
  const {
    data: apiData,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useGetPairedApps(
    {
      page: pagination.current,
      pageSize: pagination.pageSize,
      venueId: filters.venueId,
      status: filters.status,
    },
    // The new phone shows up the moment it pairs — look every 10 s meanwhile
    { refetchInterval: pairingKey ? 10 * 1000 : 60 * 1000 },
  );

  const { data: optionsData } = useGetPairedAppOptions();
  const revokeMutation = useRevokePairedApp();
  const deleteMutation = useDeletePairedApp();

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

  const handleFilterChange = useCallback((key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPagination((prev) => ({ ...prev, current: 1 }));
  }, []);

  const handleClearFilters = useCallback(() => {
    setFilters({ venueId: "", status: "" });
    setPagination((prev) => ({ ...prev, current: 1 }));
  }, []);

  const handleCreate = useCallback(() => {
    setSelectedApp(null);
    setDrawerOpen(true);
  }, []);

  const handleEdit = useCallback((record) => {
    setSelectedApp(record);
    setDrawerOpen(true);
  }, []);

  const handleDrawerClose = useCallback(() => {
    setDrawerOpen(false);
    setSelectedApp(null);
  }, []);

  // On create the drawer hands back the new pairing key, shown once
  const handleDrawerSuccess = useCallback((result) => {
    setDrawerOpen(false);
    setSelectedApp(null);
    // The countdown runs from when the key arrived (10 minutes)
    if (result?.code) setPairingKey({ ...result, receivedAt: Date.now() });
  }, []);

  const handlePairingDialogClose = useCallback(() => setPairingKey(null), []);

  const handleRevokeRequest = useCallback(
    async (record) => {
      const ok = await confirm({
        title: "Unpair phone",
        description: `Unpair "${decodeHTML(
          record.name,
        )}"? The phone goes back to the pairing screen at its next use. Pair it again with a new key.`,
        confirmText: "Unpair",
        cancelText: "Cancel",
        danger: true,
      });
      if (ok) revokeMutation.mutate(record.pairedAppId);
    },
    [revokeMutation],
  );

  const handleDeleteRequest = useCallback(
    async (record) => {
      const ok = await confirm({
        title: "Delete phone",
        description: `Delete "${decodeHTML(record.name)}"? ${
          record.status === "Active"
            ? "It is unpaired too — it goes back to the pairing screen at its next use. "
            : ""
        }Clips and payments it recorded keep their history. This can't be undone.`,
        confirmText: "Delete",
        cancelText: "Cancel",
        danger: true,
      });
      if (ok) deleteMutation.mutate(record.pairedAppId);
    },
    [deleteMutation],
  );

  // ⋮ menu: Rename, Unpair, divider, Delete (danger)
  const getActionItems = useCallback(
    (record) => {
      if (!canWrite || record.status === "Deleted") return [];
      const items = [
        {
          key: "edit",
          label: "Rename",
          icon: <Pencil className="w-4 h-4" />,
          onClick: () => handleEdit(record),
        },
      ];
      if (record.status === "Active") {
        items.push({
          key: "revoke",
          label: "Unpair",
          icon: <Unlink className="w-4 h-4" />,
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
    [canWrite, handleEdit, handleRevokeRequest, handleDeleteRequest],
  );

  const { current, pageSize } = pagination;

  // ─── Columns ───────────────────────────────────────────────────────
  // # · phone + venue · app · last seen · status · ⋮
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
        title: "Phone",
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
        title: "App",
        key: "app",
        width: 160,
        render: (_, record) => (
          <span style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}>
            {record.platform ? (
              <span className="capitalize">{record.platform}</span>
            ) : (
              "—"
            )}
            {record.appVersion && (
              <span
                className="font-mono"
                style={{ fontSize: 12, color: "var(--color-text-muted)" }}
              >
                {" "}
                v{record.appVersion}
              </span>
            )}
          </span>
        ),
      },
      {
        title: "Last seen",
        dataIndex: "lastSeenSecondsAgo",
        key: "lastSeen",
        width: 160,
        render: (secondsAgo, record) => {
          if (secondsAgo === null || secondsAgo === undefined) {
            return (
              <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
                Not used yet
              </span>
            );
          }
          const recent = record.status === "Active" && secondsAgo < RECENT_SECONDS;
          return (
            <span title={formatDateTime(record.lastSeenAt)}>
              <StatusDot tone={recent ? "success" : "muted"}>
                {secondsAgo < 45 ? "Just now" : formatAgo(secondsAgo)}
              </StatusDot>
            </span>
          );
        },
      },
      {
        title: "Status",
        dataIndex: "status",
        key: "status",
        width: 120,
        render: (status) => (
          <StatusDot tone={STATUS_TONE[status] || "muted"}>
            {status === "Revoked" ? "Unpaired" : status === "Active" ? "Paired" : status}
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

  const pairedApps = apiData?.data?.pairedApps || [];

  return {
    // apiData = { success, message, data: { pairedApps, pagination } }
    data: pairedApps,
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
    handleFilterChange,
    handleClearFilters,
    drawerOpen,
    selectedApp,
    handleCreate,
    handleDrawerClose,
    handleDrawerSuccess,
    pairingKey,
    handlePairingDialogClose,
  };
};
