import {
  Ban,
  CalendarCheck,
  CalendarClock,
  CircleAlert,
  Clock,
  CreditCard,
  Link2,
  Loader2,
  Play,
  RotateCcw,
  UserX,
  Video,
} from "lucide-react";
import { Link } from "react-router";
import dayjs from "dayjs";

import { Button } from "@/components/ui/button";

import { useBookingPageHooks } from "./hooks";
import PublicLayout from "../../../components/layout/PublicLayout";
import ResultState from "../../../components/ResultState";
import Spinner from "../../../components/Spinner";
import SectionLabel from "../../../components/SectionLabel";
import BookingDateStrip from "../../../components/BookingDateStrip";
import CourtSlotPicker from "../../../components/CourtSlotPicker";
import { getImageUrl } from "../../../utils/upload";
import { decodeHTML } from "../../../utils/decode-html";
import { formatMinutes, formatPeso } from "../../../utils/dynaCam";
import { formatPhoneDisplay } from "../../../utils/phoneFormat";

const cardStyle = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-line)",
  borderRadius: "var(--radius-card)",
};

/** What the status card says, per booking status. */
const STATUS = {
  Pending: { icon: CreditCard, title: "Pay now to confirm", tone: "var(--color-warning)" },
  Confirmed: { icon: CalendarCheck, title: "You're booked", tone: "var(--color-success)" },
  CheckedIn: { icon: CalendarCheck, title: "You're checked in", tone: "var(--color-success)" },
  Completed: { icon: CalendarCheck, title: "Played — thanks for coming", tone: "var(--color-text-muted)" },
  NoShow: { icon: UserX, title: "Marked as a no-show", tone: "var(--color-error)" },
  Cancelled: { icon: Ban, title: "This booking was cancelled", tone: "var(--color-text-muted)" },
  Expired: { icon: Clock, title: "This booking was released", tone: "var(--color-text-muted)" },
};

const Row = ({ label, children }) => (
  <div className="flex justify-between gap-4 py-2.5" style={{ borderTop: "1px solid var(--color-line)" }}>
    <span style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}>{label}</span>
    <span className="text-right" style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-dark)" }}>
      {children}
    </span>
  </div>
);

/**
 * `/booking/:manageToken` (PLAN-003 Phase C) — the player's booking: where and
 * when, the price and payment, and what happens next. CR-045: no booking code
 * and no court QR — on the day, "I'm at the court — start recording" here
 * starts the camera.
 */
const BookingPage = () => {
  const {
    booking,
    venueName,
    courtName,
    isLoading,
    isFetching,
    notFound,
    loadError,
    refetch,
    handleCopyLink,
    handleCheckIn,
    isCheckingIn,
    checkInError,
    awaitingPayment,
    handlePay,
    isPaying,
    payError,
    handleCancel,
    isCancelling,
    changeError,
    moveOpen,
    handleOpenMove,
    handleCloseMove,
    moveOptions,
    moveLoading,
    moveError,
    moveDates,
    moveDate,
    moveSlot,
    movePicked,
    handlePickMoveDate,
    handlePickMoveSlot,
    handleMove,
    isMoving,
  } = useBookingPageHooks();

  if (isLoading) {
    return (
      <PublicLayout>
        <Spinner className="py-24" tip="Loading your booking…" />
      </PublicLayout>
    );
  }

  if (notFound) {
    return (
      <PublicLayout>
        <ResultState
          status="404"
          title="This booking link isn't valid"
          description="Check the link you were sent, or see your bookings in My games."
          action={
            <Button asChild>
              <Link to="/me/games">My games</Link>
            </Button>
          }
        />
      </PublicLayout>
    );
  }

  if (loadError || !booking) {
    return (
      <PublicLayout>
        <ResultState
          status="error"
          title="Couldn't load your booking"
          description="Check your connection and try again."
          action={
            <Button onClick={() => refetch()} disabled={isFetching}>
              <RotateCcw />
              Try again
            </Button>
          }
        />
      </PublicLayout>
    );
  }

  // CR-046: every unpaid booking is paid online (no pay at the desk)
  const status =
    booking.status === "Pending"
      ? { icon: CreditCard, title: awaitingPayment ? "Checking your payment…" : "Pay now to confirm", tone: "var(--color-warning)" }
      : STATUS[booking.status] || STATUS.Confirmed;
  const StatusIcon = status.icon;
  const start = dayjs(booking.startAt);
  const end = dayjs(booking.endAt);
  const logo = getImageUrl(booking.venue.logoUrl);
  const live = ["Pending", "Confirmed"].includes(booking.status) && !booking.hasEnded;
  const venuePhone = booking.venue.phone ? formatPhoneDisplay(booking.venue.phone) : null;
  // Phase H: what the player can still change themselves, and until when
  const canChange = booking.actions.cancel || booking.actions.move;
  const cutoff = dayjs(booking.cancelCutoffAt).format("h:mm A, ddd MMM D");
  const paidOnline = booking.paymentStatus === "Paid" && booking.payMethod === "Online";
  const cutoffText = booking.actions.cancel
    ? paidOnline
      ? `Cancel by ${cutoff} for a full refund.`
      : `You can cancel until ${cutoff}.`
    : `You can change it until ${cutoff}.`;

  return (
    <PublicLayout wide footer="Keep this page's link — it's how you get back to your booking.">
      <div className="grid gap-4 lg:grid-cols-2 lg:gap-6 lg:items-start">
        {/* Left: status, paying, check-in, the code (CR-035: two columns on wide screens) */}
        <div className="space-y-4 min-w-0">
          {/* Status */}
          <div className="p-6 text-center" style={cardStyle}>
            {logo && (
              <img src={logo} alt="" className="object-contain mx-auto mb-3" style={{ maxHeight: 56, maxWidth: 180 }} />
            )}
            <span
              className="inline-flex items-center justify-center w-12 h-12 rounded-full mb-3"
              style={{ background: "var(--color-surface-sunken)", border: `2px solid ${status.tone}` }}
            >
              <StatusIcon className="w-6 h-6" style={{ color: status.tone }} />
            </span>
            <h1
              className="m-0 font-semibold leading-tight"
              style={{ fontSize: 24, letterSpacing: "-0.4px", color: "var(--color-text-dark)" }}
            >
              {status.title}
            </h1>
            <p className="m-0 mt-1" style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>
              {courtName} · {venueName}
            </p>

            {booking.status === "Pending" && awaitingPayment && (
              <p
                className="m-0 mt-3 inline-flex items-center gap-2"
                role="status"
                style={{ fontSize: 13.5, color: "var(--color-text-dark)" }}
              >
                <Loader2 className="size-4 animate-spin" />
                This page updates by itself once the payment comes through.
              </p>
            )}
            {booking.status === "Pending" && booking.payBy && !awaitingPayment && (
              <p className="m-0 mt-3" style={{ fontSize: 13.5, color: "var(--color-text-dark)" }}>
                {`Pay ${formatPeso(booking.price)} online by `}
                <strong>{dayjs(booking.payBy).format("h:mm A, ddd MMM D")}</strong>, or the court is released.
              </p>
            )}
            {booking.status === "Expired" && (
              <p className="m-0 mt-3" style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}>
                It wasn&apos;t paid in time, so the court was released. You can book again if it&apos;s still free.
              </p>
            )}
            {booking.status === "Cancelled" && (
              <p className="m-0 mt-3" style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}>
                {booking.paymentStatus === "Refunded"
                  ? "What you paid was refunded."
                  : "Questions? Contact the venue."}
              </p>
            )}
          </div>

          {/* Phase F: pay online — first time, or again after a checkout was closed */}
          {booking.actions.payOnline && (
            <div className="p-5" style={cardStyle}>
              <Button
                type="button"
                size="lg"
                variant="default"
                className="w-full h-12 text-base font-semibold"
                onClick={handlePay}
                disabled={isPaying}
              >
                {isPaying ? <Loader2 className="size-5 animate-spin" /> : <CreditCard className="size-5" />}
                {booking.checkoutOpen ? `Pay again — ${formatPeso(booking.price)}` : `Pay ${formatPeso(booking.price)} now`}
              </Button>
              {payError && (
                <p role="alert" className="m-0 mt-3 text-center" style={{ fontSize: 13.5, color: "var(--color-error)" }}>
                  {payError}
                </p>
              )}
              <p className="m-0 mt-3 text-center" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
                {booking.paymentSandbox
                  ? "Test checkout — no real money moves."
                  : "GCash, Maya or a card, on Xendit's secure page."}
                {booking.checkoutOpen && " Already paid? It shows here within a minute."}
              </p>
            </div>
          )}

          {/* Phase D: the booked game — check in during its time, then watch it */}
          {booking.actions.checkIn && (
            <div className="p-5" style={cardStyle}>
              <Button
                type="button"
                size="lg"
                className="w-full h-14 text-base font-semibold"
                onClick={handleCheckIn}
                disabled={isCheckingIn}
              >
                {isCheckingIn ? <Loader2 className="size-5 animate-spin" /> : <Play className="size-5" />}
                {isCheckingIn ? "Checking in…" : "I'm at the court — start recording"}
              </Button>
              {checkInError && (
                <p role="alert" className="m-0 mt-3 text-center" style={{ fontSize: 13.5, color: "var(--color-error)" }}>
                  {checkInError}
                </p>
              )}
              <p className="m-0 mt-3 text-center" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
                Tap it when you&apos;re on {courtName} — the camera records your booked time.
              </p>
            </div>
          )}
          {booking.gameShareToken && (
            <Button asChild size="lg" className="w-full h-14 text-base font-semibold">
              <Link to={`/session/${booking.gameShareToken}`}>
                <Video className="size-5" />
                {booking.status === "CheckedIn" ? "Go to your game" : "Watch your game"}
              </Link>
            </Button>
          )}

          {/* CR-045: no court QR and no booking code — the camera starts from this page */}
          {live && !booking.actions.checkIn && !booking.gameShareToken && (
            <div
              className="p-4 flex items-start gap-2.5"
              style={{ ...cardStyle, fontSize: 13.5, color: "var(--color-text-dark)" }}
            >
              <Play className="size-4.5 shrink-0 mt-0.5" style={{ color: "var(--color-text-secondary)" }} />
              <span>
                {booking.status === "Pending" ? "Once it's paid, come" : "Come"} back to this page at the court
                {" "}from {dayjs(booking.checkInFrom).format("h:mm A")}
                {dayjs(booking.checkInFrom).isSame(dayjs(), "day")
                  ? " today"
                  : ` on ${dayjs(booking.checkInFrom).format("ddd, MMM D")}`}{" "}
                and tap <strong>I&apos;m at the court — start recording</strong>. The camera on {courtName} records
                your booked time. It&apos;s also in My games and the link in your email.
              </span>
            </div>
          )}
        </div>

        {/* Right: details, changes, the link (CR-035) */}
        <div className="space-y-4 min-w-0">
          {/* Details */}
          <div className="px-5 pt-2.5 pb-1.5" style={cardStyle}>
            <div className="py-2.5" style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-dark)" }}>
              Booking
            </div>
            <Row label="When">{start.format("ddd, MMM D, YYYY")}</Row>
            <Row label="Time">
              {start.format("h:mm A")} – {end.format("h:mm A")} ({formatMinutes(booking.durationMinutes)})
            </Row>
            <Row label="Court">{courtName}</Row>
            <Row label="Name">{decodeHTML(booking.playerName)}</Row>
            <Row label="Price">
              {formatPeso(booking.price)}
              {" · "}
              {booking.paymentStatus === "Unpaid"
                ? "to pay online"
                : booking.paymentStatus === "Free"
                  ? "free"
                  : booking.paymentStatus === "Paid" && booking.payMethod === "Online"
                    ? "paid online"
                    : booking.paymentStatus.toLowerCase()}
            </Row>
            {booking.venue.address && <Row label="Where">{decodeHTML(booking.venue.address)}</Row>}
          </div>

          {/* Phase H: cancel or move it yourself until the cut-off */}
          {live && canChange && (
            <div className="p-5" style={cardStyle}>
              <SectionLabel>Change your booking</SectionLabel>
              {moveOpen ? (
                <div className="space-y-5">
                  <p className="m-0" style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                    Pick a new time for your {formatMinutes(booking.durationMinutes)}. You can move once, to a time that
                    costs {formatPeso(booking.price)} or less — your price stays the same.
                  </p>
                  {moveDates.length > 0 && (
                    <BookingDateStrip dates={moveDates} date={moveDate} today={moveOptions?.today} onPick={handlePickMoveDate} />
                  )}
                  <CourtSlotPicker
                    availability={moveOptions}
                    loading={moveLoading}
                    error={moveError}
                    durationMinutes={booking.durationMinutes}
                    slot={moveSlot}
                    onPick={handlePickMoveSlot}
                    unavailableLabel="—"
                    emptyHint="Nothing free at your price that day — try another date."
                  />
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" className="h-11" onClick={handleCloseMove}>
                      Back
                    </Button>
                    <Button type="button" className="h-11 flex-1" onClick={handleMove} disabled={!movePicked || isMoving}>
                      {isMoving ? <Loader2 className="animate-spin" /> : <CalendarClock />}
                      {movePicked
                        ? `Move to ${movePicked.courtName}, ${movePicked.start.format("ddd MMM D, h:mm A")}`
                        : "Pick a new time"}
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    {booking.actions.move ? (
                      <Button type="button" variant="outline" className="h-11" onClick={handleOpenMove}>
                        <CalendarClock />
                        Move
                      </Button>
                    ) : (
                      <span />
                    )}
                    {booking.actions.cancel && (
                      <Button type="button" variant="outline" className="h-11" onClick={handleCancel} disabled={isCancelling}>
                        {isCancelling ? <Loader2 className="animate-spin" /> : <Ban />}
                        Cancel
                      </Button>
                    )}
                  </div>
                  <p className="m-0 mt-3" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
                    {cutoffText}
                    {booking.actions.move
                      ? " You can move it once, to a time that costs the same or less."
                      : booking.movedOnce
                        ? " You've already moved it once."
                        : ""}
                    {booking.paidAtDesk ? " It was paid at the desk, so call the venue to cancel it." : ""}
                  </p>
                </>
              )}
              {changeError && (
                <p role="alert" className="m-0 mt-3" style={{ fontSize: 13.5, color: "var(--color-error)" }}>
                  {changeError}
                </p>
              )}
            </div>
          )}
          {live && !canChange && (
            <p className="m-0 flex items-start gap-2 px-1" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
              <CircleAlert className="size-4 shrink-0 mt-0.5" />
              <span>
                To cancel or change this booking, call the venue{venuePhone ? ` on ${venuePhone}` : ""}.
              </span>
            </p>
          )}

          <Button type="button" variant="outline" className="w-full" onClick={handleCopyLink}>
            <Link2 />
            Copy this page&apos;s link
          </Button>
        </div>
      </div>
    </PublicLayout>
  );
};

export default BookingPage;
