import { useState, useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { Copy, Pencil, Printer, Settings2, Trash2 } from "lucide-react";
import RowActions from "../../../../components/RowActions";
import StatusDot from "../../../../components/StatusDot";
import CameraStatusChip from "../components/CameraStatusChip";
import LiveChip from "../components/LiveChip";
import { useDebounce } from "../../../../hooks/useDebounce";
import { usePermissions } from "../../../../hooks/usePermissions";
import { decodeHTML } from "../../../../utils/decode-html";
import { copyText } from "../../../../utils/clipboard";
import { courtSetupPath, courtSignPath } from "../../../../utils/dynaCam";
import { confirm } from "../../../../store/confirmStore";
import { useGetVenueById } from "../../../../services/requests/admin/venues";
import {
  useGetCourts,
  useGetCourtOptions,
  useDeleteCourt,
} from "../../../../services/requests/admin/courts";

/**
 * The venue page: its info (venues/list) and its courts (venues/courts).
 * A user with only one of the two sees only that part.
 */
export const useVenueDetailHooks = () => {
  const { venueId } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const canReadVenue = hasPermission("venues", "list", "read");
  const canEditVenue = hasPermission("venues", "list", "write");
  const canReadCourts = hasPermission("venues", "courts", "read");
  const canWriteCourts = hasPermission("venues", "courts", "write");

  const [pagination, setPagination] = useState({ current: 1, pageSize: 20 });
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 500);

  // ─── Drawer State ──────────────────────────────────────────────────
  const [venueDrawerOpen, setVenueDrawerOpen] = useState(false);
  const [courtDrawerOpen, setCourtDrawerOpen] = useState(false);
  const [selectedCourt, setSelectedCourt] = useState(null);

  // ─── API Hooks ─────────────────────────────────────────────────────
  const {
    data: venueData,
    isLoading: venueLoading,
    error: venueError,
  } = useGetVenueById(venueId, { enabled: canReadVenue });

  // Without venues/list, the venue's name comes from the Courts options
  const { data: optionsData, isLoading: optionsLoading } = useGetCourtOptions({
    enabled: !canReadVenue && canReadCourts,
  });

  const {
    data: courtsData,
    isLoading: courtsLoading,
    isFetching: courtsFetching,
    error: courtsError,
    refetch: refetchCourts,
  } = useGetCourts(
    {
      page: pagination.current,
      pageSize: pagination.pageSize,
      search: debouncedSearch,
      venueId,
    },
    {
      enabled: canReadCourts && !!venueId,
      // Camera health comes from the box's heartbeat — keep it moving
      refetchInterval: 30 * 1000,
    },
  );

  const deleteCourtMutation = useDeleteCourt();

  const venue = useMemo(() => {
    if (canReadVenue) return venueData?.data?.venue || null;
    const option = (optionsData?.data?.venues || []).find(
      (v) => v.venueId === venueId,
    );
    return option ? { venueId, name: option.name, status: option.status } : null;
  }, [canReadVenue, venueData, optionsData, venueId]);

  const venueName = decodeHTML(venue?.name);
  const notFound = canReadVenue
    ? venueError?.response?.status === 404
    : !optionsLoading && !venue;

  // ─── Handlers ──────────────────────────────────────────────────────
  const handleTableChange = useCallback((next) => {
    setPagination({ current: next.current, pageSize: next.pageSize });
  }, []);

  const handleSearch = useCallback((value) => {
    setSearch(value);
    setPagination((prev) => ({ ...prev, current: 1 }));
  }, []);

  const handleEditVenue = useCallback(() => setVenueDrawerOpen(true), []);
  const handleVenueDrawerClose = useCallback(() => setVenueDrawerOpen(false), []);

  const handleAddCourt = useCallback(() => {
    setSelectedCourt(null);
    setCourtDrawerOpen(true);
  }, []);

  const handleEditCourt = useCallback((record) => {
    setSelectedCourt(record);
    setCourtDrawerOpen(true);
  }, []);

  const handleCourtDrawerClose = useCallback(() => {
    setCourtDrawerOpen(false);
    setSelectedCourt(null);
  }, []);

  // A new court goes straight to its camera setup
  const handleCourtDrawerSuccess = useCallback(
    (result) => {
      setCourtDrawerOpen(false);
      setSelectedCourt(null);
      if (result?.courtId) navigate(courtSetupPath(venueId, result.courtId));
    },
    [navigate, venueId],
  );

  const handleSetUp = useCallback(
    (record) => navigate(courtSetupPath(venueId, record.courtId)),
    [navigate, venueId],
  );

  const handlePrint = useCallback((record) => {
    window.open(courtSignPath(record.courtId), "_blank", "noopener");
  }, []);

  const handleCopyLink = useCallback(async (record) => {
    const ok = await copyText(record.qrUrl);
    if (ok) toast.success("Player link copied");
    else toast.error("Couldn't copy the link");
  }, []);

  const handleDeleteRequest = useCallback(
    async (record) => {
      const ok = await confirm({
        title: "Delete court",
        description: `Delete "${decodeHTML(
          record.name,
        )}"? Its QR sign stops working. Clips already saved stay until they expire. This can't be undone.`,
        confirmText: "Delete court",
        cancelText: "Cancel",
        danger: true,
      });
      if (ok) deleteCourtMutation.mutate(record.courtId);
    },
    [deleteCourtMutation],
  );

  // ⋮ menu: Set up camera, Print QR, Copy link, divider, Edit, Delete
  const getActionItems = useCallback(
    (record) => {
      if (record.status === "Deleted") return [];
      const items = [
        {
          key: "setup",
          label: "Set up camera",
          icon: <Settings2 className="w-4 h-4" />,
          onClick: () => handleSetUp(record),
        },
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
      ];
      if (canWriteCourts) {
        items.push(
          { type: "divider" },
          {
            key: "edit",
            label: "Rename / status",
            icon: <Pencil className="w-4 h-4" />,
            onClick: () => handleEditCourt(record),
          },
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
      canWriteCourts,
      handleSetUp,
      handlePrint,
      handleCopyLink,
      handleEditCourt,
      handleDeleteRequest,
    ],
  );

  const { current, pageSize } = pagination;

  // ─── Columns ───────────────────────────────────────────────────────
  // # · court (+ Live) · camera · recorder box · button · status · ⋮
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
        render: (_, record) => (
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => handleSetUp(record)}
              className="truncate text-left cursor-pointer hover:underline"
              style={{
                fontSize: 14,
                fontWeight: 500,
                color: "var(--color-text-dark)",
              }}
            >
              {decodeHTML(record.name)}
            </button>
            {record.stream?.enabled && <LiveChip title={record.stream.watchUrl} />}
          </div>
        ),
      },
      {
        title: "Camera",
        key: "camera",
        width: 150,
        render: (_, record) => <CameraStatusChip camera={record.camera} />,
      },
      {
        title: "Recorder box",
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
        width: 110,
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
    [getActionItems, handleSetUp, current, pageSize],
  );

  const courts = courtsData?.data?.courts || [];
  const venueRawName = venue?.name;
  // Stable object: the drawer re-hydrates whenever its entity changes
  const courtDrawerEntity = useMemo(
    () => selectedCourt || { venueId, venueName: venueRawName },
    [selectedCourt, venueId, venueRawName],
  );

  return {
    venueId,
    venue,
    venueName,
    venueLoading: canReadVenue ? venueLoading : optionsLoading,
    venueError: canReadVenue && !notFound ? venueError : null,
    notFound,
    canReadVenue,
    canEditVenue,
    canReadCourts,
    canWriteCourts,
    // apiData = { success, message, data: { courts, pagination } }
    courts,
    pagination: {
      ...pagination,
      total: courtsData?.data?.pagination?.total || 0,
    },
    search,
    courtsLoading,
    courtsFetching,
    courtsError,
    refetchCourts,
    columns,
    handleTableChange,
    handleSearch,
    venueDrawerOpen,
    handleEditVenue,
    handleVenueDrawerClose,
    courtDrawerOpen,
    // Create: the drawer adds the court to this venue
    courtDrawerEntity,
    handleAddCourt,
    handleCourtDrawerClose,
    handleCourtDrawerSuccess,
  };
};
