import { useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router";
import { ArrowRight, Pencil, Trash2 } from "lucide-react";
import RowActions from "../../../../components/RowActions";
import StatusDot from "../../../../components/StatusDot";
import { useDebounce } from "../../../../hooks/useDebounce";
import { usePermissions } from "../../../../hooks/usePermissions";
import { decodeHTML } from "../../../../utils/decode-html";
import { formatPhoneDisplay } from "../../../../utils/phoneFormat";
import { formatPeso, venuePath } from "../../../../utils/dynaCam";
import { getImageUrl } from "../../../../utils/upload";
import { confirm } from "../../../../store/confirmStore";
import {
  useGetVenues,
  useDeleteVenue,
} from "../../../../services/requests/admin/venues";

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export const useVenueHooks = () => {
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const canWrite = hasPermission("venues", "list", "write");
  // Courts-only users (no venues/list) get a venue picker instead of the list
  const canList = hasPermission("venues", "list", "read");

  const [pagination, setPagination] = useState({ current: 1, pageSize: 10 });
  const [filters, setFilters] = useState({ search: "", status: "" });
  const debouncedSearch = useDebounce(filters.search, 500);

  // ─── Drawer State ──────────────────────────────────────────────────
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedVenue, setSelectedVenue] = useState(null);

  // ─── API Hooks ─────────────────────────────────────────────────────
  const {
    data: apiData,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useGetVenues(
    {
      page: pagination.current,
      pageSize: pagination.pageSize,
      search: debouncedSearch,
      status: filters.status,
    },
    { enabled: canList },
  );

  const deleteMutation = useDeleteVenue();

  // ─── Handlers ──────────────────────────────────────────────────────
  const handleTableChange = useCallback((next) => {
    setPagination({ current: next.current, pageSize: next.pageSize });
  }, []);

  const handleSearch = useCallback((value) => {
    setFilters((prev) => ({ ...prev, search: value }));
    setPagination((prev) => ({ ...prev, current: 1 }));
  }, []);

  const handleStatusFilter = useCallback((value) => {
    setFilters((prev) => ({ ...prev, status: value }));
    setPagination((prev) => ({ ...prev, current: 1 }));
  }, []);

  const handleClearFilters = useCallback(() => {
    setFilters({ search: "", status: "" });
    setPagination((prev) => ({ ...prev, current: 1 }));
  }, []);

  const handleCreate = useCallback(() => {
    setSelectedVenue(null);
    setDrawerOpen(true);
  }, []);

  const handleEdit = useCallback((record) => {
    setSelectedVenue(record);
    setDrawerOpen(true);
  }, []);

  const handleDrawerClose = useCallback(() => {
    setDrawerOpen(false);
    setSelectedVenue(null);
  }, []);

  // Deleting a venue takes its courts and recorder boxes with it — say so.
  const handleDeleteRequest = useCallback(
    async (record) => {
      const courts = Number(record.courtCount) || 0;
      const devices = Number(record.deviceCount) || 0;
      const ok = await confirm({
        title: "Delete venue",
        description: `Delete "${decodeHTML(record.name)}"? Its ${plural(
          courts,
          "court",
          "courts",
        )} will be removed too, and its ${plural(
          devices,
          "recorder box is",
          "recorder boxes are",
        )} revoked. Clips already saved stay until they expire. This can't be undone.`,
        confirmText: "Delete venue",
        cancelText: "Cancel",
        danger: true,
      });
      if (ok) deleteMutation.mutate(record.venueId);
    },
    [deleteMutation],
  );

  // ⋮ menu: Edit, divider, Delete (danger)
  const handleOpen = useCallback(
    (record) => navigate(venuePath(record.venueId)),
    [navigate],
  );

  // ⋮ menu: Open, Edit, divider, Delete (danger)
  const getActionItems = useCallback(
    (record) => {
      if (record.status === "Deleted") return [];
      const open = {
        key: "open",
        label: "Open venue",
        icon: <ArrowRight className="w-4 h-4" />,
        onClick: () => handleOpen(record),
      };
      if (!canWrite) return [open];
      return [
        open,
        {
          key: "edit",
          label: "Edit venue",
          icon: <Pencil className="w-4 h-4" />,
          onClick: () => handleEdit(record),
        },
        { type: "divider" },
        {
          key: "delete",
          label: "Delete venue",
          icon: <Trash2 className="w-4 h-4" />,
          danger: true,
          onClick: () => handleDeleteRequest(record),
        },
      ];
    },
    [canWrite, handleOpen, handleEdit, handleDeleteRequest],
  );

  const { current, pageSize } = pagination;

  // ─── Columns ───────────────────────────────────────────────────────
  // # · logo + name/address · phone · courts/boxes · retention · status · ⋮
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
        title: "Venue",
        dataIndex: "name",
        key: "name",
        render: (_, record) => {
          const label = decodeHTML(record.name) || "";
          const initial = (label.trim().charAt(0) || "?").toUpperCase();
          return (
            <div className="flex items-center gap-3 min-w-0">
              <span
                className="overflow-hidden"
                style={{
                  width: 34,
                  height: 34,
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
                {record.logoUrl ? (
                  <img
                    src={getImageUrl(record.logoUrl)}
                    alt=""
                    className="w-full h-full object-contain"
                    width={34}
                    height={34}
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  initial
                )}
              </span>
              <div className="min-w-0">
                {/* The name opens the venue page (its courts) */}
                {record.status === "Deleted" ? (
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
                ) : (
                  <button
                    type="button"
                    onClick={() => handleOpen(record)}
                    className="block max-w-full truncate text-left cursor-pointer hover:underline"
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      color: "var(--color-text-dark)",
                    }}
                  >
                    {label}
                  </button>
                )}
                <div
                  className="truncate"
                  style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}
                >
                  {decodeHTML(record.address) || "No address"}
                </div>
              </div>
            </div>
          );
        },
      },
      {
        title: "Phone",
        dataIndex: "phone",
        key: "phone",
        width: 150,
        render: (phone) => (
          <span
            style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}
          >
            {formatPhoneDisplay(phone) || "-"}
          </span>
        ),
      },
      {
        title: "Courts · boxes",
        key: "counts",
        width: 140,
        render: (_, record) => (
          <span
            style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}
          >
            {Number(record.courtCount) || 0}
            <span style={{ color: "var(--color-text-muted)" }}> · </span>
            {Number(record.deviceCount) || 0}
          </span>
        ),
      },
      {
        title: "Keeps videos",
        dataIndex: "clipRetentionDays",
        key: "clipRetentionDays",
        width: 120,
        render: (days) => (
          <span
            style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}
          >
            {plural(Number(days) || 0, "day", "days")}
          </span>
        ),
      },
      {
        title: "Clip price",
        dataIndex: "clipPrice",
        key: "clipPrice",
        width: 110,
        render: (price) => (
          <span
            style={{
              fontSize: 13.5,
              color:
                Number(price) > 0
                  ? "var(--color-text-dark)"
                  : "var(--color-text-muted)",
            }}
          >
            {Number(price) > 0 ? formatPeso(price) : "Free"}
          </span>
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
    [getActionItems, handleOpen, current, pageSize],
  );

  const venues = apiData?.data?.venues || [];

  return {
    // apiData = { success, message, data: { venues, pagination } }
    data: venues,
    pagination: { ...pagination, total: apiData?.data?.pagination?.total || 0 },
    filters,
    isLoading,
    isFetching,
    error,
    refetch,
    canWrite,
    canList,
    columns,
    handleTableChange,
    handleSearch,
    handleStatusFilter,
    handleClearFilters,
    drawerOpen,
    selectedVenue,
    handleCreate,
    handleDrawerClose,
  };
};
