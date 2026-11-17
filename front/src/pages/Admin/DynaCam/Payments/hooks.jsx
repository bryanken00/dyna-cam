import { useState, useCallback, useMemo } from "react";
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
import {
  useGetPayments,
  useRefundPayment,
  useGetPaymentOptions,
} from "../../../../services/requests/admin/payments";

const EMPTY_FILTERS = { venueId: "", status: "", dateFrom: "", dateTo: "" };

const METHOD_LABEL = { CASH: "Cash" };

export const usePaymentHooks = () => {
  const { hasPermission } = usePermissions();
  const canWrite = hasPermission("payments", null, "write");
  // There is no payments options endpoint; the venue list comes from the
  // Clips options, so the venue filter needs clips read too.
  // The venue filter comes from /payments/options, so payments access is enough
  const canListVenues = true;

  const [pagination, setPagination] = useState({ current: 1, pageSize: 20 });
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [takePaymentOpen, setTakePaymentOpen] = useState(false);

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

  const handleOpenTakePayment = useCallback(() => setTakePaymentOpen(true), []);
  const handleCloseTakePayment = useCallback(
    () => setTakePaymentOpen(false),
    [],
  );

  const handleRefundRequest = useCallback(
    async (record) => {
      const ok = await confirm({
        title: "Refund payment",
        description: `Refund ${formatPeso(record.amount)} for pay code ${formatPayCode(
          record.payCode,
        )} (${decodeHTML(record.courtName)})? Give the cash back to the player — the clip locks again until it is paid.`,
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
    [canWrite, handleRefundRequest],
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
            <StatusDot tone={PAYMENT_STATUS_TONE[status] || "muted"}>
              {status}
            </StatusDot>
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

  return {
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
    takePaymentOpen,
    handleOpenTakePayment,
    handleCloseTakePayment,
  };
};
