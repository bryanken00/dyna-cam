import { Navigate } from "react-router";
import {
  CalendarCheck,
  CalendarClock,
  CircleAlert,
  CreditCard,
  Loader2,
  LogIn,
  Phone,
  RotateCcw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

import { useBookPageHooks } from "./hooks";
import PublicLayout from "../../../components/layout/PublicLayout";
import ResultState from "../../../components/ResultState";
import SectionLabel from "../../../components/SectionLabel";
import Spinner from "../../../components/Spinner";
import BookingDatePicker from "../../../components/BookingDatePicker";
import CourtSlotPicker from "../../../components/CourtSlotPicker";
import GoogleSignInButton from "../../../components/player/GoogleSignInButton";
import { getImageUrl } from "../../../utils/upload";
import { decodeHTML } from "../../../utils/decode-html";
import { formatPeso } from "../../../utils/dynaCam";
import {
  PHONE_MAX_LENGTH,
  PHONE_PLACEHOLDER,
  formatPhoneDisplay,
  formatPhoneOnChange,
} from "../../../utils/phoneFormat";

const FOOTER = "Your game is recorded only once you check in at the court.";

const cardStyle = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-line)",
  borderRadius: "var(--radius-card)",
};

const iconPrefix = "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2";
const mutedIcon = { color: "var(--color-text-muted)" };

/**
 * `/book/:bookingToken` (PLAN-003 Phase C) — a venue's online booking page:
 * date → length → court and start time → who's playing → Book. Phase F: Pay
 * now sends the player to Xendit's checkout (GCash, Maya, card…); Pay at the
 * desk holds the court and lands them on their booking's own page. CR-032:
 * on wide screens the picker is the left column and the details card the
 * right one, kept in view; phones keep the single column. PLAN-006: booking
 * needs a Google sign-in — anyone can browse the times; Book asks a signed-out
 * player to sign in first (and brings them back to the same slot).
 */
const BookPage = () => {
  const {
    page,
    signedIn,
    profileRedirect,
    player,
    playerLoading,
    signInAvailable,
    signInReturnPath,
    handleLeaveToSignIn,
    venueName,
    isLoading,
    isFetching,
    notFound,
    loadError,
    refetch,
    openDays,
    date,
    availability,
    availabilityLoading,
    availabilityError,
    isPicked,
    picked,
    handlePickDate,
    handleTogglePick,
    handleClearPicks,
    form,
    handleBook,
    payOnline,
    paymentSandbox,
    isBooking,
    bookError,
  } = useBookPageHooks();

  if (profileRedirect) return <Navigate to={profileRedirect} replace />;

  if (isLoading) {
    return (
      <PublicLayout>
        <Spinner className="py-24" tip="Loading…" />
      </PublicLayout>
    );
  }

  if (notFound) {
    return (
      <PublicLayout>
        <ResultState
          status="404"
          title="This booking link isn't valid"
          description="It may be out of date, or the venue isn't taking online bookings right now. Ask the venue for its current link."
        />
      </PublicLayout>
    );
  }

  if (loadError || !page) {
    return (
      <PublicLayout>
        <ResultState
          status="error"
          title="Couldn't load the booking page"
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

  const logo = getImageUrl(page.venue.logoUrl);

  return (
    <PublicLayout footer={FOOTER} wide signIn={signInAvailable}>
      <div className="space-y-4">
        {/* Venue */}
        <div className="p-6 flex flex-col items-center gap-2 text-center" style={cardStyle}>
          {logo && <img src={logo} alt="" className="object-contain" style={{ maxHeight: 64, maxWidth: 200 }} />}
          <h1
            className="m-0 font-semibold leading-tight"
            style={{ fontSize: 28, letterSpacing: "-0.5px", color: "var(--color-text-dark)" }}
          >
            Book a court
          </h1>
          <p className="m-0" style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-secondary)" }}>
            {venueName}
          </p>
          {page.venue.address && (
            <p className="m-0" style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
              {decodeHTML(page.venue.address)}
            </p>
          )}
        </div>

        {!signInAvailable || !payOnline ? (
          // PLAN-006: booking online needs a Google sign-in, which this server doesn't have
          <div className="p-6" style={cardStyle}>
            <ResultState
              status="404"
              icon={<CalendarClock className="w-6 h-6" strokeWidth={1.8} />}
              title="Online booking isn't available right now"
              description={
                page.venue.phone
                  ? `Please call ${formatPhoneDisplay(page.venue.phone)} or book at the front desk.`
                  : "Please call the venue or book at the front desk."
              }
            />
          </div>
        ) : page.courts.length === 0 ? (
          <div className="p-6" style={cardStyle}>
            <ResultState
              status="error"
              title="No courts to book right now"
              description="Please call the venue to book."
            />
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-6">
            {/* Left: date, then courts and hours (CR-047: tap as many as you like) */}
            <div className="p-5 space-y-6 min-w-0" style={cardStyle}>
              {/* Date */}
              <div>
                <SectionLabel>Date</SectionLabel>
                <BookingDatePicker date={date} today={page.today} openDays={openDays} onPick={handlePickDate} />
              </div>

              {/* Court + time */}
              <div>
                <SectionLabel>Courts and hours</SectionLabel>
                <p className="m-0 mb-3" style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
                  Tap every hour you want, on any court, up to closing. Hours next to each other on a court
                  are one game; you pay for everything at once.
                </p>
                <CourtSlotPicker
                  availability={availability}
                  loading={availabilityLoading}
                  error={availabilityError}
                  durationMinutes={60}
                  isPicked={isPicked}
                  onPick={handleTogglePick}
                  emptyHint="Nothing free that day — try another date."
                  columnsClassName="grid-cols-3 sm:grid-cols-4 xl:grid-cols-6"
                />
              </div>
            </div>

            {/* Right: details + book. CR-032: stretched to the left card's height,
                its contents kept in view while the left side scrolls */}
            <div className="flex flex-col gap-4 min-w-0">
              {picked ? (
                <div className="p-5 lg:flex-1" style={cardStyle}>
                  <div className="lg:sticky lg:top-6">
                    {/* CR-047: one game per run of neighbouring hours, all paid together */}
                    <div
                      className="mb-5"
                      style={{
                        background: "var(--color-surface-sunken)",
                        border: "1px solid var(--color-line)",
                        borderRadius: 12,
                      }}
                    >
                      <div
                        className="px-3.5 pt-3 flex items-center justify-between"
                        style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}
                      >
                        <span>{picked.runs[0].start.format("ddd, MMM D")}</span>
                        <button type="button" onClick={handleClearPicks} className="hover:underline">
                          Clear
                        </button>
                      </div>
                      <ul className="m-0 p-0 list-none">
                        {picked.runs.map((run) => (
                          <li
                            key={`${run.courtKey}@${run.startTime}`}
                            className="px-3.5 py-2.5 flex items-center justify-between gap-3"
                          >
                            <div className="min-w-0">
                              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-dark)" }}>
                                {run.courtName}
                              </div>
                              <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                                {run.start.format("h:mm A")} – {run.end.format("h:mm A")}
                              </div>
                            </div>
                            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-dark)" }}>
                              {formatPeso(run.price)}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <div
                        className="px-3.5 py-3 flex items-center justify-between"
                        style={{ borderTop: "1px solid var(--color-line)" }}
                      >
                        <span style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}>
                          {picked.runs.length === 1 ? "1 game" : `${picked.runs.length} games`}
                        </span>
                        <span style={{ fontSize: 20, fontWeight: 600, color: "var(--color-text-dark)" }}>
                          {formatPeso(picked.total)}
                        </span>
                      </div>
                    </div>

                    {!signedIn ? (
                      // PLAN-006: signed out — sign in with Google first, then come back to this slot
                      <div className="space-y-4">
                        <div className="flex items-start gap-2.5" style={{ fontSize: 13.5, color: "var(--color-text-dark)" }}>
                          <LogIn className="size-4.5 shrink-0 mt-0.5" style={{ color: "var(--color-text-secondary)" }} />
                          <span>
                            Sign in with Google to book. Your booking and the videos of your games are saved to
                            your account — find them any time in My games.
                          </span>
                        </div>
                        <GoogleSignInButton
                          returnPath={signInReturnPath}
                          onClick={handleLeaveToSignIn}
                          className="w-full h-12"
                        />
                      </div>
                    ) : (
                    <Form {...form}>
                      <form onSubmit={handleBook} noValidate>
                        <SectionLabel>Who&apos;s booking</SectionLabel>
                        <div className="space-y-4">
                          {/* PLAN-006: the name and email are the player's Google account */}
                          <div
                            className="p-3"
                            style={{ border: "1px solid var(--color-line)", borderRadius: 12 }}
                          >
                            {playerLoading || !player ? (
                              <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>Loading your details…</span>
                            ) : (
                              <>
                                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-dark)" }}>
                                  {player.name}
                                </div>
                                <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{player.email}</div>
                              </>
                            )}
                          </div>
                          <FormField
                            control={form.control}
                            name="phone"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Phone</FormLabel>
                                <div className="relative">
                                  <Phone className={iconPrefix} style={mutedIcon} />
                                  <FormControl>
                                    <Input
                                      placeholder={PHONE_PLACEHOLDER}
                                      className="h-11 pl-9"
                                      inputMode="tel"
                                      autoComplete="tel"
                                      maxLength={PHONE_MAX_LENGTH}
                                      {...field}
                                      onChange={(e) => field.onChange(formatPhoneOnChange(e.target.value))}
                                    />
                                  </FormControl>
                                </div>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>

                        {/* CR-046: pay first to reserve — always online, no pay at the desk */}
                        <div
                          className="mt-5 flex items-start gap-2.5 p-3"
                          style={{
                            background: "var(--color-surface-sunken)",
                            border: "1px solid var(--color-line)",
                            borderRadius: 12,
                            fontSize: 13,
                            color: "var(--color-text-dark)",
                          }}
                        >
                          <CreditCard
                            className="size-4.5 shrink-0 mt-0.5"
                            style={{ color: "var(--color-text-secondary)" }}
                          />
                          <span>
                            {paymentSandbox
                              ? `Pay ${formatPeso(picked.total)} on a test checkout — no real money moves.`
                              : `Pay ${formatPeso(picked.total)} with GCash, Maya or a card on Xendit's secure page.`}{" "}
                            The court is yours once it&apos;s paid — we hold it for {page.rules.onlineHoldMinutes} minutes
                            while you pay. Cancel up to {page.rules.cancelCutoffHours} hours before for a full refund.
                          </span>
                        </div>

                        <Button
                          type="submit"
                          size="lg"
                          className="w-full mt-5 h-12"
                          disabled={isBooking || playerLoading || !player}
                        >
                          {isBooking ? <Loader2 className="animate-spin" /> : <CalendarCheck />}
                          {picked.runs.length === 1
                            ? `Book ${picked.runs[0].courtName}, pay ${formatPeso(picked.total)} now`
                            : `Book ${picked.runs.length} games, pay ${formatPeso(picked.total)} now`}
                        </Button>
                      </form>
                    </Form>
                    )}
                  </div>
                </div>
              ) : (
                <div
                  className="hidden lg:flex lg:flex-1 p-6 flex-col items-center justify-center gap-2 text-center"
                  style={{ ...cardStyle, borderStyle: "dashed" }}
                >
                  <CalendarClock className="size-6" style={mutedIcon} />
                  <p className="m-0" style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-dark)" }}>
                    Pick your hours
                  </p>
                  <p className="m-0" style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
                    Choose a date, then tap the hours you want on any courts. What you&apos;re booking and the total show here.
                  </p>
                </div>
              )}

              {/* Outside the details card: a refused slot is cleared, and the card with it */}
              {bookError && (
                <p
                  role="alert"
                  className="m-0 flex items-start gap-2 p-3"
                  style={{
                    fontSize: 13.5,
                    color: "var(--color-error)",
                    border: "1px solid var(--color-line)",
                    borderRadius: 12,
                    background: "var(--color-surface)",
                  }}
                >
                  <CircleAlert className="size-4 shrink-0 mt-0.5" />
                  {bookError}
                </p>
              )}
            </div>
          </div>
        )}

        {page.venue.phone && (
          <p className="m-0 text-center" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
            Questions? Call {formatPhoneDisplay(page.venue.phone)}
          </p>
        )}
      </div>
    </PublicLayout>
  );
};

export default BookPage;
