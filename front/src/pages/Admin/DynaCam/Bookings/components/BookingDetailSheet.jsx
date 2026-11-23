import { useState } from "react";
import {
  Ban,
  Banknote,
  CalendarCheck,
  CalendarClock,
  CircleAlert,
  Copy,
  Play,
  Trash2,
  UserX,
  X,
} from "lucide-react";
import { toast } from "sonner";
import dayjs from "dayjs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import CancelBookingFormModal from "./CancelBookingFormModal";
import MoveBookingFormModal from "./MoveBookingFormModal";
import DescriptionList from "../../../../../components/DescriptionList";
import SectionLabel from "../../../../../components/SectionLabel";
import Spinner from "../../../../../components/Spinner";
import StatusDot from "../../../../../components/StatusDot";
import { usePermissions } from "../../../../../hooks/usePermissions";
import { confirm } from "../../../../../store/confirmStore";
import { copyText } from "../../../../../utils/clipboard";
import { decodeHTML } from "../../../../../utils/decode-html";
import { formatPhoneDisplay } from "../../../../../utils/phoneFormat";
import {
  BOOKING_PAYMENT_LABEL,
  BOOKING_STATUS_LABEL,
  BOOKING_STATUS_TONE,
  PAYMENT_STATUS_TONE,
  SESSION_STATUS_TONE,
  formatDateTime,
  formatMinutes,
  formatPayCode,
  formatPeso,
  formatTimeRange,
  manilaNow,
} from "../../../../../utils/dynaCam";
import {
  useCheckInBooking,
  useDeleteBooking,
  useGetBookingById,
  useMarkNoShow,
  useRecordBookingPayment,
} from "../../../../../services/requests/admin/bookings";

const OPEN_STATUSES = ["Pending", "Confirmed"];

/**
 * PLAN-003: one booking — when and where, the player, its payments and its
 * game — with the desk's actions. Props: `{ open, bookingId, courts, onClose }`
 * (courts: every venue's courts from the options; Move offers the booking's own).
 */
const BookingDetailSheet = ({ open, bookingId, courts = [], onClose }) => {
  const { hasPermission } = usePermissions();
  const canWrite = hasPermission("bookings", null, "write");
  const canTakePayments = hasPermission("payments", null, "write");

  const [moveOpen, setMoveOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const { data, isLoading, error } = useGetBookingById(bookingId, { enabled: open });
  const booking = data?.data?.booking || null;

  const payMutation = useRecordBookingPayment();
  const noShowMutation = useMarkNoShow();
  const deleteMutation = useDeleteBooking();
  const checkInMutation = useCheckInBooking();

  const now = manilaNow();
  const nowLocal = `${now.date} ${now.time}:00`;
  const isOpen = booking && OPEN_STATUSES.includes(booking.status);
  const started = booking && booking.startAt <= nowLocal;
  // Phase D: Check in is open from checkInFrom until the booking ends
  const canCheckIn =
    booking?.status === "Confirmed" && booking.checkInFrom <= nowLocal && nowLocal < booking.endAt;

  const handleRecordPayment = async () => {
    const ok = await confirm({
      title: "Record payment",
      description: `Take ${formatPeso(booking.price)} cash from ${decodeHTML(
        booking.playerName,
      )} for booking ${formatPayCode(booking.bookingCode)}? The booking is confirmed.`,
      confirmText: `Record ${formatPeso(booking.price)}`,
      cancelText: "Cancel",
    });
    if (ok) payMutation.mutate({ bookingId: booking.bookingId, payment: {} });
  };

  // The player's own booking page — for a phone booking, send it to them
  const handleCopyLink = async () => {
    const ok = await copyText(booking.manageUrl);
    if (ok) toast.success("Link copied — send it to the player");
    else toast.error("Couldn't copy the link");
  };

  const handleNoShow = async () => {
    const ok = await confirm({
      title: "Mark as a no-show",
      description: `${decodeHTML(booking.playerName)} didn't come. The booking is kept as a no-show; its payment isn't refunded.`,
      confirmText: "Mark no-show",
      cancelText: "Cancel",
      danger: true,
    });
    if (ok) noShowMutation.mutate(booking.bookingId);
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: "Delete booking",
      description: "Delete this booking made by mistake? Its slot is freed. This can't be undone.",
      confirmText: "Delete booking",
      cancelText: "Cancel",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteMutation.mutateAsync(booking.bookingId);
      onClose();
    } catch (err) {
      console.error("Delete booking error:", err);
    }
  };

  const holdLine =
    booking?.status === "Pending" && booking.holdExpiresAt
      ? `Held until ${formatDateTime(booking.holdExpiresAt)} — released if not paid by then`
      : null;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full gap-0 p-0 sm:max-w-200"
        style={{ background: "var(--color-surface)" }}
      >
        <SheetTitle className="sr-only">Booking</SheetTitle>
        <SheetDescription className="sr-only">A court booking and its payments</SheetDescription>

        <div className="flex h-full flex-col">
          <div className="flex-1 overflow-y-auto p-6">
            {/* Header */}
            <div className="flex items-start justify-between gap-3 mb-6">
              <div className="flex items-center gap-3 min-w-0">
                <span className="inline-flex items-center justify-center w-11 h-11 rounded-xl shrink-0 bg-(image:--gradient-primary)">
                  <CalendarCheck className="w-5.5 h-5.5 text-white" />
                </span>
                <div className="min-w-0">
                  <h2
                    className="m-0 font-semibold leading-tight truncate"
                    style={{ fontSize: 19, color: "var(--color-text-dark)" }}
                  >
                    {booking ? decodeHTML(booking.playerName) : "Booking"}
                  </h2>
                  {booking && (
                    <p className="m-0 mt-0.5 flex items-center gap-2 flex-wrap" style={{ fontSize: 13 }}>
                      <span
                        className="font-mono"
                        style={{ letterSpacing: "0.06em", color: "var(--color-text-dark)" }}
                      >
                        {formatPayCode(booking.bookingCode)}
                      </span>
                      <StatusDot tone={BOOKING_STATUS_TONE[booking.status] || "muted"}>
                        {BOOKING_STATUS_LABEL[booking.status] || booking.status}
                      </StatusDot>
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="inline-flex items-center justify-center shrink-0 transition-colors hover:bg-(--color-surface-sunken)"
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  border: "1px solid var(--color-line)",
                  color: "var(--color-text-secondary)",
                }}
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            {isLoading && <Spinner className="py-16" tip="Loading booking…" />}

            {error && (
              <Alert variant="destructive">
                <CircleAlert />
                <AlertTitle>
                  {error.response?.status === 404 ? "Booking not found" : "Error loading the booking"}
                </AlertTitle>
                <AlertDescription>
                  {error.response?.status === 404
                    ? "It may have been deleted."
                    : error.message || "Please try again."}
                </AlertDescription>
              </Alert>
            )}

            {booking && (
              <>
                {holdLine && (
                  <Alert className="mb-5">
                    <Banknote />
                    <AlertTitle>Waiting for payment at the desk</AlertTitle>
                    <AlertDescription>{holdLine}</AlertDescription>
                  </Alert>
                )}

                <SectionLabel>Booking</SectionLabel>
                <DescriptionList
                  items={[
                    { label: "Court", value: `${decodeHTML(booking.courtName)} · ${decodeHTML(booking.venueName)}` },
                    {
                      label: "When",
                      value: `${dayjs(booking.startAt).format("ddd, MMM D, YYYY")} · ${formatTimeRange(
                        booking.startAt,
                        booking.endAt,
                      )}`,
                    },
                    { label: "Length", value: formatMinutes(booking.durationMinutes) },
                    {
                      label: "Price",
                      value: `${formatPeso(booking.price)} · ${
                        BOOKING_PAYMENT_LABEL[booking.paymentStatus] || booking.paymentStatus
                      }`,
                    },
                    {
                      label: "Booked",
                      value: `${formatDateTime(booking.dateCreated)} · ${
                        booking.source === "Online" ? "online" : `at the desk${booking.createdBy ? ` by ${decodeHTML(booking.createdBy)}` : ""}`
                      }`,
                    },
                    ...(booking.status === "Cancelled"
                      ? [
                          {
                            label: "Cancelled",
                            value: `${formatDateTime(booking.cancelledAt)} · ${decodeHTML(booking.cancelReason) || "—"}`,
                          },
                        ]
                      : []),
                  ]}
                />

                <div className="mt-6">
                  <SectionLabel>Player</SectionLabel>
                  <DescriptionList
                    items={[
                      { label: "Name", value: decodeHTML(booking.playerName) },
                      { label: "Phone", value: booking.phone ? formatPhoneDisplay(booking.phone) : "—" },
                      { label: "Email", value: booking.email || "—" },
                      {
                        label: "Booking page",
                        value: (
                          <button
                            type="button"
                            onClick={handleCopyLink}
                            className="inline-flex items-center gap-1.5 cursor-pointer hover:underline"
                            style={{ color: "var(--color-link)" }}
                          >
                            <Copy className="w-3.5 h-3.5" />
                            Copy the player&apos;s link
                          </button>
                        ),
                      },
                    ]}
                  />
                </div>

                <div className="mt-6">
                  <SectionLabel>Payments</SectionLabel>
                  {booking.payments.length === 0 ? (
                    <p className="m-0" style={{ fontSize: 13.5, color: "var(--color-text-muted)" }}>
                      {booking.paymentStatus === "Free" ? "Free — no payment." : "Nothing paid yet."}
                    </p>
                  ) : (
                    <ul className="m-0 p-0 list-none space-y-2">
                      {booking.payments.map((p) => (
                        <li
                          key={p.paymentId}
                          className="flex items-center justify-between gap-3 px-3.5 py-2.5"
                          style={{ border: "1px solid var(--color-line)", borderRadius: 10 }}
                        >
                          <div className="min-w-0">
                            <div style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-dark)" }}>
                              {formatPeso(p.amount)} · {p.method === "ONLINE" ? "Online" : "Cash"}
                            </div>
                            <div className="truncate" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
                              {formatDateTime(p.paidAt)}
                              {p.receivedBy ? ` · ${decodeHTML(p.receivedBy)}` : ""}
                              {p.status === "Refunded" && p.refundedAt ? ` · refunded ${formatDateTime(p.refundedAt)}` : ""}
                            </div>
                          </div>
                          <StatusDot tone={PAYMENT_STATUS_TONE[p.status] || "muted"}>{p.status}</StatusDot>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {booking.game && (
                  <div className="mt-6">
                    <SectionLabel>Game</SectionLabel>
                    <DescriptionList
                      items={[
                        {
                          label: "Recorded",
                          value: formatTimeRange(booking.game.startAt, booking.game.endAt),
                        },
                        {
                          label: "Status",
                          value: (
                            <StatusDot tone={SESSION_STATUS_TONE[booking.game.status] || "muted"}>
                              {booking.game.status}
                            </StatusDot>
                          ),
                        },
                      ]}
                    />
                  </div>
                )}
              </>
            )}
          </div>

          {/* Actions */}
          {booking && canWrite && (
            <div
              className="flex justify-end gap-2.5 flex-wrap p-6 pt-5"
              style={{
                borderTop: "1px solid var(--color-line)",
                paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))",
              }}
            >
              {booking.status !== "CheckedIn" &&
                booking.status !== "Completed" &&
                booking.payments.length === 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleDelete}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 />
                    Delete
                  </Button>
                )}
              {booking.status === "Confirmed" && started && (
                <Button type="button" variant="outline" onClick={handleNoShow} disabled={noShowMutation.isPending}>
                  <UserX />
                  No-show
                </Button>
              )}
              {isOpen && (
                <>
                  <Button type="button" variant="outline" onClick={() => setCancelOpen(true)}>
                    <Ban />
                    Cancel
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setMoveOpen(true)}>
                    <CalendarClock />
                    Move
                  </Button>
                </>
              )}
              {canCheckIn && (
                <Button
                  type="button"
                  onClick={() => checkInMutation.mutate(booking.bookingId)}
                  disabled={checkInMutation.isPending}
                >
                  <Play />
                  Check in
                </Button>
              )}
              {booking.status === "Pending" && booking.paymentStatus === "Unpaid" && canTakePayments && (
                <Button type="button" onClick={handleRecordPayment} disabled={payMutation.isPending}>
                  <Banknote />
                  Record {formatPeso(booking.price)} cash
                </Button>
              )}
            </div>
          )}
        </div>

        {canWrite && (
          <>
            <MoveBookingFormModal
              open={moveOpen}
              booking={booking}
              courts={courts.filter(
                (c) => c.venueId === booking?.venueId && c.status === "Active",
              )}
              onClose={() => setMoveOpen(false)}
              onSuccess={() => setMoveOpen(false)}
            />
            <CancelBookingFormModal
              open={cancelOpen}
              booking={booking}
              onClose={() => setCancelOpen(false)}
              onSuccess={() => setCancelOpen(false)}
            />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};

export default BookingDetailSheet;
