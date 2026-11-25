import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import dayjs from "dayjs";
import { Pencil, Trash2 } from "lucide-react";
import RowActions from "../../../../components/RowActions";
import { usePermissions } from "../../../../hooks/usePermissions";
import { decodeHTML } from "../../../../utils/decode-html";
import { copyText } from "../../../../utils/clipboard";
import { bookingSignPath, formatTimeRange } from "../../../../utils/dynaCam";
import { confirm } from "../../../../store/confirmStore";
import {
  useConfirmScheduleWeek,
  useGetBookingSettings,
  useIssueBookingLink,
  useTurnOffBookingLink,
  useUnconfirmScheduleWeek,
} from "../../../../services/requests/admin/bookingSettings";
import {
  useDeleteClosure,
  useGetClosures,
} from "../../../../services/requests/admin/closures";

/** "Mon, Nov 24 · 8:00 AM – 12:00 PM", or both dates when it spans days. */
const formatWindow = (startAt, endAt) =>
  dayjs(startAt).isSame(dayjs(endAt), "day")
    ? `${dayjs(startAt).format("ddd, MMM D")} · ${formatTimeRange(startAt, endAt)}`
    : formatTimeRange(startAt, endAt);

/**
 * PLAN-003 Phase A: the venue page's booking parts (bookings permission) —
 * online booking link, rules / hours / rates, and closures.
 */
export const useVenueBookingHooks = (venueId, { isDeleted = false } = {}) => {
  const { hasPermission } = usePermissions();
  const canReadBookings = hasPermission("bookings", null, "read");
  const canWriteBookings = hasPermission("bookings", null, "write") && !isDeleted;

  // ─── State ─────────────────────────────────────────────────────────
  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false);
  const [closureDrawerOpen, setClosureDrawerOpen] = useState(false);
  const [selectedClosure, setSelectedClosure] = useState(null);
  const [closuresWhen, setClosuresWhen] = useState("upcoming");
  const [closuresPagination, setClosuresPagination] = useState({ current: 1, pageSize: 10 });

  // ─── API Hooks ─────────────────────────────────────────────────────
  const {
    data: settingsData,
    isLoading: settingsLoading,
    error: settingsError,
  } = useGetBookingSettings(venueId, { enabled: canReadBookings });

  const {
    data: closuresData,
    isLoading: closuresLoading,
    isFetching: closuresFetching,
    error: closuresError,
    refetch: refetchClosures,
  } = useGetClosures(
    {
      venueId,
      when: closuresWhen,
      page: closuresPagination.current,
      pageSize: closuresPagination.pageSize,
    },
    { enabled: canReadBookings },
  );

  const issueLinkMutation = useIssueBookingLink();
  const confirmWeekMutation = useConfirmScheduleWeek();
  const unconfirmWeekMutation = useUnconfirmScheduleWeek();
  const turnOffLinkMutation = useTurnOffBookingLink();
  const deleteClosureMutation = useDeleteClosure();

  // apiData = { success, message, data: { settings, courts } }
  const settings = settingsData?.data?.settings || null;
  const courts = useMemo(() => settingsData?.data?.courts || [], [settingsData]);
  const closures = closuresData?.data?.closures || [];

  // ─── Online booking link ───────────────────────────────────────────
  const handleIssueLink = useCallback(async () => {
    if (settings?.bookingEnabled) {
      const ok = await confirm({
        title: "Issue a new booking link",
        description:
          "The link and QR you've shared stop working right away — share the new one. Bookings already made are kept.",
        confirmText: "Issue new link",
        cancelText: "Cancel",
        danger: true,
      });
      if (!ok) return;
    }
    issueLinkMutation.mutate(venueId);
  }, [settings, issueLinkMutation, venueId]);

  const handleTurnOffLink = useCallback(async () => {
    const ok = await confirm({
      title: "Turn online booking off",
      description:
        "Players can't book from the link or QR until you turn it on again (that gives a new link). Bookings already made are kept, and the desk can still book.",
      confirmText: "Turn off",
      cancelText: "Cancel",
      danger: true,
    });
    if (ok) turnOffLinkMutation.mutate(venueId);
  }, [turnOffLinkMutation, venueId]);

  const handleCopyLink = useCallback(async () => {
    if (!settings?.bookingUrl) return;
    const ok = await copyText(settings.bookingUrl);
    if (ok) toast.success("Booking link copied");
    else toast.error("Couldn't copy the link");
  }, [settings]);

  const handlePrintSign = useCallback(() => {
    window.open(bookingSignPath(venueId), "_blank", "noopener");
  }, [venueId]);

  // ─── CR-043: confirm next week's schedule ──────────────────────────
  const handleConfirmWeek = useCallback(() => {
    confirmWeekMutation.mutate(venueId);
  }, [confirmWeekMutation, venueId]);

  // Only while nobody has booked next week (the API checks again)
  const handleUnconfirmWeek = useCallback(async () => {
    const schedule = settings?.schedule;
    if (!schedule) return;
    const week = `${dayjs(schedule.nextWeekStart).format("MMM D")} – ${dayjs(schedule.nextWeekEnd).format("MMM D")}`;
    const ok = await confirm({
      title: "Undo next week's confirmation",
      description: `Players can't book ${week} online until you confirm it again. Nobody has booked it yet.`,
      confirmText: "Undo confirmation",
      cancelText: "Keep it",
      danger: true,
    });
    if (ok) unconfirmWeekMutation.mutate(venueId);
  }, [settings, unconfirmWeekMutation, venueId]);

  // ─── Settings drawer ───────────────────────────────────────────────
  const handleEditSettings = useCallback(() => setSettingsDrawerOpen(true), []);
  const handleSettingsDrawerClose = useCallback(() => setSettingsDrawerOpen(false), []);
  // Stable object: the drawer re-hydrates whenever its entity changes
  const settingsDrawerEntity = useMemo(
    () => (settings ? { settings, courts } : null),
    [settings, courts],
  );

  // ─── Closures ──────────────────────────────────────────────────────
  const handleClosuresWhenChange = useCallback((when) => {
    setClosuresWhen(when);
    setClosuresPagination((prev) => ({ ...prev, current: 1 }));
  }, []);

  const handleClosuresTableChange = useCallback((next) => {
    setClosuresPagination({ current: next.current, pageSize: next.pageSize });
  }, []);

  const handleAddClosure = useCallback(() => {
    setSelectedClosure(null);
    setClosureDrawerOpen(true);
  }, []);

  const handleEditClosure = useCallback((record) => {
    setSelectedClosure(record);
    setClosureDrawerOpen(true);
  }, []);

  const handleClosureDrawerClose = useCallback(() => {
    setClosureDrawerOpen(false);
    setSelectedClosure(null);
  }, []);

  const handleDeleteClosure = useCallback(
    async (record) => {
      const ok = await confirm({
        title: "Remove closure",
        description: `Reopen ${
          record.courtName ? decodeHTML(record.courtName) : "the whole venue"
        } for ${formatWindow(record.startAt, record.endAt)}? Bookings it cancelled stay cancelled.`,
        confirmText: "Remove closure",
        cancelText: "Cancel",
        danger: true,
      });
      if (ok) deleteClosureMutation.mutate(record.closureId);
    },
    [deleteClosureMutation],
  );

  const closureDrawerEntity = useMemo(
    () =>
      selectedClosure
        ? { ...selectedClosure, venueId, courts }
        : { venueId, courts },
    [selectedClosure, venueId, courts],
  );

  const closureColumns = useMemo(
    () => [
      {
        title: "When",
        key: "when",
        render: (_, record) => (
          <span style={{ fontSize: 13.5, color: "var(--color-text-dark)" }}>
            {formatWindow(record.startAt, record.endAt)}
          </span>
        ),
      },
      {
        title: "Court",
        key: "court",
        width: 170,
        render: (_, record) => (
          <span style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}>
            {record.courtName ? decodeHTML(record.courtName) : "Whole venue"}
          </span>
        ),
      },
      {
        title: "Reason",
        dataIndex: "reason",
        key: "reason",
        render: (reason) => (
          <span style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}>
            {reason ? decodeHTML(reason) : "-"}
          </span>
        ),
      },
      {
        title: "",
        key: "actions",
        width: 60,
        align: "right",
        render: (_, record) =>
          canWriteBookings && closuresWhen !== "past" ? (
            <RowActions
              items={[
                {
                  key: "edit",
                  label: "Edit",
                  icon: <Pencil className="w-4 h-4" />,
                  onClick: () => handleEditClosure(record),
                },
                {
                  key: "delete",
                  label: "Remove",
                  icon: <Trash2 className="w-4 h-4" />,
                  danger: true,
                  onClick: () => handleDeleteClosure(record),
                },
              ]}
            />
          ) : null,
      },
    ],
    [canWriteBookings, closuresWhen, handleEditClosure, handleDeleteClosure],
  );

  return {
    canReadBookings,
    canWriteBookings,
    // settings
    settings,
    settingsLoading,
    settingsError,
    isIssuingLink: issueLinkMutation.isPending,
    isTurningOffLink: turnOffLinkMutation.isPending,
    handleIssueLink,
    handleTurnOffLink,
    handleCopyLink,
    handlePrintSign,
    settingsDrawerOpen,
    settingsDrawerEntity,
    handleEditSettings,
    handleSettingsDrawerClose,
    isConfirmingWeek: confirmWeekMutation.isPending,
    handleConfirmWeek,
    isUnconfirmingWeek: unconfirmWeekMutation.isPending,
    handleUnconfirmWeek,
    // closures — apiData = { success, message, data: { closures, pagination } }
    closures,
    closuresPagination: {
      ...closuresPagination,
      total: closuresData?.data?.pagination?.total || 0,
    },
    closuresWhen,
    closuresLoading,
    closuresFetching,
    closuresError,
    refetchClosures,
    closureColumns,
    handleClosuresWhenChange,
    handleClosuresTableChange,
    closureDrawerOpen,
    closureDrawerEntity,
    handleAddClosure,
    handleClosureDrawerClose,
  };
};
