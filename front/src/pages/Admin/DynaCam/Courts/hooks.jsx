import { useState, useCallback, useMemo } from "react";
import { toast } from "sonner";
import {
  Copy,
  ExternalLink,
  Pencil,
  Printer,
  RefreshCcw,
  Trash2,
} from "lucide-react";
import RowActions from "../../../../components/RowActions";
import StatusDot from "../../../../components/StatusDot";
import CameraChip from "./components/CameraChip";
import { useDebounce } from "../../../../hooks/useDebounce";
import { usePermissions } from "../../../../hooks/usePermissions";
import { decodeHTML } from "../../../../utils/decode-html";
import { copyText } from "../../../../utils/clipboard";
import { confirm } from "../../../../store/confirmStore";
import {
  useGetCourts,
  useGetCourtOptions,
  useRotateCourtQr,
  useDeleteCourt,
} from "../../../../services/requests/admin/courts";

/** Route of the printable A5 sign (registered outside the sidebar layout). */
export const courtSignPath = (courtId) =>
  `/admin/dyna-cam/courts/${courtId}/print`;

export const useCourtHooks = () => {
  const { hasPermission } = usePermissions();
  const canWrite = hasPermission("venues", "courts", "write");

  const [pagination, setPagination] = useState({ current: 1, pageSize: 10 });
  const [filters, setFilters] = useState({
    search: "",
    venueId: "",
    status: "",
  });
  const debouncedSearch = useDebounce(filters.search, 500);

  // ─── Drawer State ──────────────────────────────────────────────────
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedCourt, setSelectedCourt] = useState(null);

  // ─── API Hooks ─────────────────────────────────────────────────────
  const {
    data: apiData,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useGetCourts({
    page: pagination.current,
    pageSize: pagination.pageSize,
    search: debouncedSearch,
    venueId: filters.venueId,
    status: filters.status,
  });

  // Venue filter options — under this page's own permission
  const { data: optionsData } = useGetCourtOptions();

  const rotateMutation = useRotateCourtQr();
  const deleteMutation = useDeleteCourt();

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
    setSelectedCourt(null);
    setDrawerOpen(true);
  }, []);

  const handleEdit = useCallback((record) => {
    setSelectedCourt(record);
    setDrawerOpen(true);
  }, []);

  const handleDrawerClose = useCallback(() => {
    setDrawerOpen(false);
    setSelectedCourt(null);
  }, []);

  const handlePrint = useCallback((record) => {
    window.open(courtSignPath(record.courtId), "_blank", "noopener");
  }, []);

  const handleCopyLink = useCallback(async (record) => {
    const ok = await copyText(record.qrUrl);
    if (ok) toast.success("Player link copied");
    else toast.error("Couldn't copy the link");
  }, []);

  const handleOpenPlayerPage = useCallback((record) => {
    window.open(record.qrUrl, "_blank", "noopener");
  }, []);

  const handleRotateRequest = useCallback(
    async (record) => {
      const ok = await confirm({
        title: "Issue a new QR code",
        description: `Issue a new QR code for "${decodeHTML(
          record.name,
        )}"? The sign printed for this court stops working right away — print and put up the new one.`,
        confirmText: "Issue new code",
        cancelText: "Cancel",
        danger: true,
      });
      if (ok) rotateMutation.mutate(record.courtId);
    },
    [rotateMutation],
  );

  const handleDeleteRequest = useCallback(
    async (record) => {
      const ok = await confirm({
        title: "Delete court",
        description: `Delete "${decodeHTML(record.name)}" at ${decodeHTML(
          record.venueName,
        )}? Its QR sign stops working. Clips already saved stay until they expire. This can't be undone.`,
        confirmText: "Delete court",
        cancelText: "Cancel",
        danger: true,
      });
      if (ok) deleteMutation.mutate(record.courtId);
    },
    [deleteMutation],
  );

  // ⋮ menu: Print QR + link actions, Edit, Rotate QR, divider, Delete
  const getActionItems = useCallback(
    (record) => {
      if (record.status === "Deleted") return [];
      const items = [
        {
          key: "print",
          label: "Print QR sign",
          icon: <Printer className="w-4 h-4" />,
          onClick: () => handlePrint(record),
        },
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
          onClick: () => handleOpenPlayerPage(record),
        },
      ];
      if (canWrite) {
        items.push(
          { type: "divider" },
          {
            key: "edit",
            label: "Edit court",
            icon: <Pencil className="w-4 h-4" />,
            onClick: () => handleEdit(record),
          },
          {
            key: "rotate",
            label: "Issue new QR code",
            icon: <RefreshCcw className="w-4 h-4" />,
            onClick: () => handleRotateRequest(record),
          },
          { type: "divider" },
          {
            key: "delete",
            label: "Delete court",
            icon: <Trash2 className="w-4 h-4" />,
            danger: true,
            onClick: () => handleDeleteRequest(record),
          },
        );
      }
      return items;
    },
    [
      canWrite,
      handlePrint,
      handleCopyLink,
      handleOpenPlayerPage,
      handleEdit,
      handleRotateRequest,
      handleDeleteRequest,
    ],
  );

  const { current, pageSize } = pagination;

  // ─── Columns ───────────────────────────────────────────────────────
  // # · court + venue · camera · recorder · status · ⋮
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
        title: "Camera",
        key: "camera",
        width: 230,
        render: (_, record) => <CameraChip camera={record.camera} />,
      },
      {
        title: "Recorder",
        dataIndex: "recorderOnline",
        key: "recorderOnline",
        width: 130,
        render: (online) => (
          <StatusDot tone={online ? "success" : "muted"}>
            {online ? "Online" : "Offline"}
          </StatusDot>
        ),
      },
      {
        title: "Status",
        dataIndex: "status",
        key: "status",
        width: 120,
        render: (status) => (
          <StatusDot tone={status === "Active" ? "success" : "muted"}>
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

  const courts = apiData?.data?.courts || [];

  return {
    // apiData = { success, message, data: { courts, pagination } }
    data: courts,
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
    selectedCourt,
    handleCreate,
    handleDrawerClose,
  };
};
