import { useState, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";
import RowActions from "../../../../components/RowActions";
import StatusDot from "../../../../components/StatusDot";
import { usePermissions } from "../../../../hooks/usePermissions";
import { decodeHTML } from "../../../../utils/decode-html";
import {
  PAYMENT_STATUS_TONE,
  formatDateTime,
  formatPayCode,
  formatPeso,
} from "../../../../utils/dynaCam";
import { confirm } from "../../../../store/confirmStore";
import { copyText } from "../../../../utils/clipboard";
import {
  useDisconnectCompanyPayments,
  useGetCompanyPayments,
} from "../../../../services/requests/admin/companyPayments";
import {
  useGetPayments,
  useRefundPayment,
  useGetPaymentOptions,
} from "../../../../services/requests/admin/payments";

const EMPTY_FILTERS = { venueId: "", status: "", dateFrom: "", dateTo: "" };

const METHOD_LABEL = { CASH: "Cash", ONLINE: "Online" };

/** What was paid for: a replay, a whole game (CR-015) or a court booking (PLAN-003). */
const KIND_LABEL = { Clip: "Replay", Game: "Game", Booking: "Court booking" };

export const usePaymentHooks = () => {
  const { hasPermission } = usePermissions();
  const canWrite = hasPermission("payments", null, "write");
  // There is no payments options endpoint; the venue list comes from the
  // Clips options, so the venue filter needs clips read too.
  // The venue filter comes from /payments/options, so payments access is enough
  const canListVenues = true;

  const [pagination, setPagination] = useState({ current: 1, pageSize: 20 });
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  // ─── API Hooks ─────────────────────────────────────────────────────
  const {
    data: apiData,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useGetPayments({
    page: pagination.current,
    pageSize: pagination.pageSize,
    ...filters,
  });

  const { data: optionsData } = useGetPaymentOptions();
  const refundMutation = useRefundPayment();

  const venueOptions = useMemo(
    () =>
      (optionsData?.data?.venues || []).map((v) => ({
        value: v.venueId,
        label: decodeHTML(v.name),
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
    setFilters(EMPTY_FILTERS);
    setPagination((prev) => ({ ...prev, current: 1 }));
  }, []);

  // Phase F: Xendit refused a booking's online refund; staff repaid the player by hand
  const handleMarkRepaid = useCallback(
    async (record) => {
      const ok = await confirm({
        title: "Mark as repaid by hand",
        description: `The online refund of ${formatPeso(record.amount)} for ${record.kind === "Open Play" ? "Open Play spot" : "booking"} ${formatPayCode(
          record.payCode,
        )} failed (${decodeHTML(record.refundError)}). Mark it refunded once you've given the player their money back another way.`,
        confirmText: "Mark repaid",
        cancelText: "Cancel",
      });
      if (ok) refundMutation.mutate({ paymentId: record.paymentId });
    },
    [refundMutation],
  );

  const handleRefundRequest = useCallback(
    async (record) => {
      const ok = await confirm({
        title: "Refund payment",
        description: `Refund ${formatPeso(record.amount)} for pay code ${formatPayCode(
          record.payCode,
        )} (${decodeHTML(record.courtName)})? Give the cash back to the player — the ${
          record.kind === "Game" ? "game's videos lock" : "clip locks"
        } again until it is paid.`,
        confirmText: "Refund",
        cancelText: "Cancel",
        danger: true,
      });
      if (ok) refundMutation.mutate({ paymentId: record.paymentId });
    },
    [refundMutation],
  );

  const getActionItems = useCallback(
    (record) => {
      if (!canWrite || record.status !== "Paid") return [];
      // Phase F: a failed online refund of a booking, repaid by hand
      // PLAN-009: an Open Play spot's the same way
      if (["Booking", "Open Play", "Tournament"].includes(record.kind) && record.refundError) {
        return [
          {
            key: "repaid",
            label: "Mark repaid by hand",
            icon: <Undo2 className="w-4 h-4" />,
            onClick: () => handleMarkRepaid(record),
          },
        ];
      }
      // PLAN-003: a booking is refunded by cancelling it in Bookings
      if (record.kind === "Booking") return [];
      // PLAN-009: an Open Play spot is refunded by cancelling it in Open Play
      if (record.kind === "Open Play") return [];
      // PLAN-009 phase E: a tournament entry is refunded by withdrawing the team
      if (record.kind === "Tournament") return [];
      return [
        {
          key: "refund",
          label: "Refund",
          icon: <Undo2 className="w-4 h-4" />,
          danger: true,
          onClick: () => handleRefundRequest(record),
        },
      ];
    },
    [canWrite, handleRefundRequest, handleMarkRepaid],
  );

  const { current, pageSize } = pagination;

  // ─── Columns ───────────────────────────────────────────────────────
  // # · paid at · court + venue · pay code · amount · method · received by ·
  // status · note · ⋮
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
        title: "Paid at",
        dataIndex: "paidAt",
        key: "paidAt",
        width: 175,
        render: (paidAt) => (
          <span
            style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}
          >
            {formatDateTime(paidAt)}
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
              {/* CR-015: a whole game, or a single replay */}
              {" · "}
              {KIND_LABEL[record.kind] || "Replay"}
            </div>
          </div>
        ),
      },
      {
        title: "Pay code",
        dataIndex: "payCode",
        key: "payCode",
        width: 110,
        render: (code) => (
          <span
            className="font-mono"
            style={{
              fontSize: 12.5,
              letterSpacing: "0.06em",
              color: "var(--color-text-dark)",
            }}
          >
            {code ? formatPayCode(code) : "—"}
          </span>
        ),
      },
      {
        title: "Amount",
        dataIndex: "amount",
        key: "amount",
        width: 100,
        align: "right",
        render: (amount, record) => (
          <span
            style={{
              fontSize: 14,
              fontWeight: 500,
              color:
                record.status === "Refunded"
                  ? "var(--color-text-muted)"
                  : "var(--color-text-dark)",
              textDecoration:
                record.status === "Refunded" ? "line-through" : "none",
            }}
          >
            {formatPeso(amount)}
          </span>
        ),
      },
      {
        title: "Method",
        dataIndex: "method",
        key: "method",
        width: 90,
        render: (method) => (
          <span
            className="inline-flex items-center whitespace-nowrap"
            style={{
              fontSize: 12,
              fontWeight: 500,
              padding: "2px 9px",
              borderRadius: 999,
              border: "1px solid var(--color-line)",
              background: "var(--color-surface-sunken)",
              color: "var(--color-text-secondary)",
            }}
          >
            {METHOD_LABEL[method] || method}
          </span>
        ),
      },
      {
        title: "Received by",
        dataIndex: "receivedBy",
        key: "receivedBy",
        width: 150,
        render: (name) => (
          <span
            className="truncate block"
            style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}
          >
            {decodeHTML(name) || "—"}
          </span>
        ),
      },
      {
        title: "Status",
        dataIndex: "status",
        key: "status",
        width: 150,
        render: (status, record) => (
          <div>
            {status === "Paid" && record.refundError ? (
              // Phase F: Xendit refused the refund — the player is still owed it
              <StatusDot tone="error">Refund failed</StatusDot>
            ) : (
              <StatusDot tone={PAYMENT_STATUS_TONE[status] || "muted"}>
                {status}
              </StatusDot>
            )}
            {status === "Refunded" && record.refundedAt && (
              <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                {formatDateTime(record.refundedAt)}
              </div>
            )}
          </div>
        ),
      },
      {
        title: "Note",
        dataIndex: "note",
        key: "note",
        width: 180,
        render: (note) => (
          <span
            className="truncate block"
            title={note ? decodeHTML(note) : undefined}
            style={{
              fontSize: 13,
              color: note
                ? "var(--color-text-secondary)"
                : "var(--color-text-muted)",
            }}
          >
            {decodeHTML(note) || "—"}
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
    [getActionItems, current, pageSize],
  );

  // ─── PLAN-008 phase C: the company's own Xendit ────────────────────
  const { data: paymentSetupData } = useGetCompanyPayments();
  const onlinePayment = paymentSetupData?.data?.payment || null;
  const disconnectMutation = useDisconnectCompanyPayments();
  const [paymentDrawerOpen, setPaymentDrawerOpen] = useState(false);

  const handleConnectPayment = useCallback(() => setPaymentDrawerOpen(true), []);
  const handlePaymentDrawerClose = useCallback(() => setPaymentDrawerOpen(false), []);
  const handleCopyWebhook = useCallback(async () => {
    if (!onlinePayment?.webhookUrl) return;
    const ok = await copyText(onlinePayment.webhookUrl);
    if (ok) toast.success("Webhook URL copied — paste it into Xendit → Settings → Webhooks");
    else toast.error("Couldn't copy the URL");
  }, [onlinePayment]);
  const handleDisconnectPayment = useCallback(async () => {
    const ok = await confirm({
      title: "Disconnect Xendit",
      description:
        "Players can't book online or pay links until you connect Xendit again. Payments already made stay, and refunds of them need Xendit connected.",
      confirmText: "Disconnect",
      cancelText: "Cancel",
      danger: true,
    });
    if (ok) disconnectMutation.mutate();
  }, [disconnectMutation]);

  return {
    onlinePayment,
    paymentDrawerOpen,
    handleConnectPayment,
    handlePaymentDrawerClose,
    handleCopyWebhook,
    handleDisconnectPayment,
    isDisconnectingPayment: disconnectMutation.isPending,
    // apiData = { success, message, data: { payments, totals, pagination } }
    data: apiData?.data?.payments || [],
    totals: apiData?.data?.totals || { today: 0, thisMonth: 0, countToday: 0 },
    pagination: { ...pagination, total: apiData?.data?.pagination?.total || 0 },
    filters,
    isLoading,
    isFetching,
    error,
    refetch,
    canWrite,
    canListVenues,
    venueOptions,
    columns,
    handleTableChange,
    handleFilterChange,
    handleClearFilters,
  };
};
