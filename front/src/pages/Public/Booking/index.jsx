import {
  Ban,
  CalendarCheck,
  CircleAlert,
  Clock,
  Copy,
  Link2,
  QrCode,
  RotateCcw,
  Store,
  UserX,
} from "lucide-react";
import dayjs from "dayjs";

import { Button } from "@/components/ui/button";

import { useBookingPageHooks } from "./hooks";
import PublicLayout from "../../../components/layout/PublicLayout";
import ResultState from "../../../components/ResultState";
import Spinner from "../../../components/Spinner";
import { getImageUrl } from "../../../utils/upload";
import { decodeHTML } from "../../../utils/decode-html";
import { formatMinutes, formatPayCode, formatPeso } from "../../../utils/dynaCam";
import { formatPhoneDisplay } from "../../../utils/phoneFormat";

const cardStyle = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-line)",
  borderRadius: "var(--radius-card)",
};

/** What the status card says, per booking status. */
const STATUS = {
  Pending: { icon: Store, title: "Pay at the desk to confirm", tone: "var(--color-warning)" },
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
 * `/booking/:manageToken` (PLAN-003 Phase C) — the player's booking: its code
 * (typed at the court QR to check in, read out at the desk), where and when,
 * the price and payment, and what happens next.
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
    handleCopyCode,
    handleCopyLink,
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
          description="Check the link you were sent, or ask the venue's front desk."
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

  const status = STATUS[booking.status] || STATUS.Confirmed;
  const StatusIcon = status.icon;
  const start = dayjs(booking.startAt);
  const end = dayjs(booking.endAt);
  const logo = getImageUrl(booking.venue.logoUrl);
  const live = ["Pending", "Confirmed"].includes(booking.status) && !booking.hasEnded;
  const venuePhone = booking.venue.phone ? formatPhoneDisplay(booking.venue.phone) : null;

  return (
    <PublicLayout footer="Keep this page's link — it's how you get back to your booking.">
      <div className="space-y-4">
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

          {booking.status === "Pending" && booking.payBy && (
            <p className="m-0 mt-3" style={{ fontSize: 13.5, color: "var(--color-text-dark)" }}>
              Pay {formatPeso(booking.price)} at the front desk by{" "}
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

        {/* Code */}
        {live && (
          <div className="p-5 text-center" style={cardStyle}>
            <div style={{ fontSize: 12.5, color: "var(--color-text-secondary)" }}>Your booking code</div>
            <button
              type="button"
              onClick={handleCopyCode}
              className="mt-1 inline-flex items-center gap-2 cursor-pointer"
              aria-label="Copy booking code"
            >
              <span
                className="font-mono"
                style={{ fontSize: 30, fontWeight: 600, letterSpacing: "0.12em", color: "var(--color-text-dark)" }}
              >
                {formatPayCode(booking.bookingCode)}
              </span>
              <Copy className="w-4.5 h-4.5" style={{ color: "var(--color-text-muted)" }} />
            </button>
            <div
              className="mt-3 flex items-start gap-2.5 p-3 text-left"
              style={{
                background: "var(--color-surface-sunken)",
                border: "1px solid var(--color-line)",
                borderRadius: 12,
                fontSize: 13,
                color: "var(--color-text-dark)",
              }}
            >
              <QrCode className="size-4.5 shrink-0 mt-0.5" style={{ color: "var(--color-text-secondary)" }} />
              <span>
                {booking.status === "Pending" ? "Once it's paid, scan" : "When you arrive, scan"} the QR sign on{" "}
                {courtName} from {dayjs(booking.checkInFrom).format("h:mm A")} and enter this code — your game
                records for your booked time.
              </span>
            </div>
          </div>
        )}

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
              ? "to pay at the desk"
              : booking.paymentStatus === "Free"
                ? "free"
                : booking.paymentStatus.toLowerCase()}
          </Row>
          {booking.venue.address && <Row label="Where">{decodeHTML(booking.venue.address)}</Row>}
        </div>

        {live && (
          <p className="m-0 flex items-start gap-2 px-1" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
            <CircleAlert className="size-4 shrink-0 mt-0.5" />
            <span>
              Need to cancel or change it? Call the venue{venuePhone ? ` on ${venuePhone}` : ""}.
            </span>
          </p>
        )}

        <Button type="button" variant="outline" className="w-full" onClick={handleCopyLink}>
          <Link2 />
          Copy this page&apos;s link
        </Button>
      </div>
    </PublicLayout>
  );
};

export default BookingPage;
