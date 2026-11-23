import {
  CalendarCheck,
  CircleAlert,
  CreditCard,
  Loader2,
  Mail,
  Phone,
  RotateCcw,
  Store,
  User,
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
import { getImageUrl } from "../../../utils/upload";
import { decodeHTML } from "../../../utils/decode-html";
import { formatHour, formatMinutes, formatPeso } from "../../../utils/dynaCam";
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

/** A pickable chip: a date, a length or a start time. */
const Chip = ({ selected, disabled, onClick, children, label, className = "" }) => (
  <button
    type="button"
    aria-pressed={selected}
    aria-label={label}
    disabled={disabled}
    onClick={onClick}
    className={`shrink-0 transition-colors disabled:cursor-not-allowed ${className}`}
    style={{
      borderRadius: 10,
      border: `1px solid ${selected ? "var(--color-text-dark)" : "var(--color-line)"}`,
      background: selected ? "var(--color-surface-sunken)" : "var(--color-surface)",
      color: disabled ? "var(--color-text-muted)" : "var(--color-text-dark)",
      opacity: disabled ? 0.55 : 1,
    }}
  >
    {children}
  </button>
);

/**
 * `/book/:bookingToken` (PLAN-003 Phase C) — a venue's online booking page:
 * date → length → court and start time → who's playing → Book. Phase F: Pay
 * now sends the player to Xendit's checkout (GCash, Maya, card…); Pay at the
 * desk holds the court and lands them on their booking's own page.
 */
const BookPage = () => {
  const {
    page,
    venueName,
    isLoading,
    isFetching,
    notFound,
    loadError,
    refetch,
    dates,
    date,
    lengths,
    durationMinutes,
    availability,
    availabilityLoading,
    availabilityError,
    slot,
    picked,
    handlePickDate,
    handlePickLength,
    handlePickSlot,
    form,
    handleBook,
    payOnline,
    payMethod,
    handlePickPayMethod,
    isBooking,
    bookError,
  } = useBookPageHooks();

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
  const holdMinutes = page.rules.deskHoldMinutes;
  const anyFree = availability?.courts.some((c) => c.slots.some((s) => s.available));

  return (
    <PublicLayout footer={FOOTER}>
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

        {page.courts.length === 0 ? (
          <div className="p-6" style={cardStyle}>
            <ResultState
              status="error"
              title="No courts to book right now"
              description="Please call the venue to book."
            />
          </div>
        ) : (
          <div className="p-5 space-y-6" style={cardStyle}>
            {/* Date */}
            <div>
              <SectionLabel>Date</SectionLabel>
              <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                {dates.map((d) => (
                  <Chip
                    key={d.date}
                    selected={d.date === date}
                    disabled={!d.open}
                    onClick={() => handlePickDate(d.date)}
                    label={d.day.format("dddd, MMMM D")}
                    className="w-15 py-2 flex flex-col items-center"
                  >
                    <span style={{ fontSize: 11.5, color: "var(--color-text-secondary)" }}>
                      {d.date === page.today ? "Today" : d.day.format("ddd")}
                    </span>
                    <span style={{ fontSize: 17, fontWeight: 600 }}>{d.day.format("D")}</span>
                    <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                      {d.open ? d.day.format("MMM") : "Closed"}
                    </span>
                  </Chip>
                ))}
              </div>
            </div>

            {/* Length */}
            <div>
              <SectionLabel>How long</SectionLabel>
              <div className="flex gap-2 flex-wrap">
                {lengths.map((m) => (
                  <Chip
                    key={m}
                    selected={m === durationMinutes}
                    onClick={() => handlePickLength(m)}
                    className="px-4 h-10"
                  >
                    <span style={{ fontSize: 14, fontWeight: 500 }}>{formatMinutes(m)}</span>
                  </Chip>
                ))}
              </div>
            </div>

            {/* Court + time */}
            <div>
              <SectionLabel>Court and start time</SectionLabel>
              {availabilityError ? (
                <p className="m-0" style={{ fontSize: 13.5, color: "var(--color-error)" }}>
                  {availabilityError.response?.data?.message || "Couldn't load the free times. Try again."}
                </p>
              ) : availabilityLoading || !availability ? (
                <Spinner className="py-8" tip="Checking free times…" />
              ) : !availability.hours ? (
                <p className="m-0" style={{ fontSize: 13.5, color: "var(--color-text-muted)" }}>
                  Closed that day — pick another date.
                </p>
              ) : !anyFree ? (
                <p className="m-0" style={{ fontSize: 13.5, color: "var(--color-text-muted)" }}>
                  Nothing free for {formatMinutes(durationMinutes)} that day — try a shorter time or
                  another date.
                </p>
              ) : (
                <div className="space-y-5">
                  {availability.courts.map((court) => (
                    <div key={court.key}>
                      <div className="mb-2" style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-dark)" }}>
                        {decodeHTML(court.name)}
                      </div>
                      {court.slots.some((s) => s.available) ? (
                        <div className="grid grid-cols-3 gap-2">
                          {court.slots.map((s) => (
                            <Chip
                              key={s.startTime}
                              selected={slot?.courtKey === court.key && slot?.startTime === s.startTime}
                              disabled={!s.available}
                              onClick={() => handlePickSlot(court.key, s.startTime)}
                              label={`${decodeHTML(court.name)} at ${formatHour(s.startTime)}${s.available ? "" : ", taken"}`}
                              className="py-2 flex flex-col items-center"
                            >
                              <span
                                style={{
                                  fontSize: 14,
                                  fontWeight: 500,
                                  textDecoration: s.available ? "none" : "line-through",
                                }}
                              >
                                {formatHour(s.startTime)}
                              </span>
                              <span style={{ fontSize: 11.5, color: "var(--color-text-muted)" }}>
                                {s.available ? formatPeso(s.price) : "Taken"}
                              </span>
                            </Chip>
                          ))}
                        </div>
                      ) : (
                        <p className="m-0" style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
                          Fully booked for {formatMinutes(durationMinutes)} that day.
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Details + book */}
        {picked && (
          <div className="p-5" style={cardStyle}>
            <div
              className="p-3.5 mb-5 flex items-center justify-between gap-3"
              style={{
                background: "var(--color-surface-sunken)",
                border: "1px solid var(--color-line)",
                borderRadius: 12,
              }}
            >
              <div className="min-w-0">
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-dark)" }}>
                  {picked.courtName} · {picked.start.format("ddd, MMM D")}
                </div>
                <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                  {picked.start.format("h:mm A")} – {picked.end.format("h:mm A")}
                </div>
              </div>
              <span style={{ fontSize: 20, fontWeight: 600, color: "var(--color-text-dark)" }}>
                {formatPeso(picked.price)}
              </span>
            </div>

            <Form {...form}>
              <form onSubmit={handleBook} noValidate>
                <SectionLabel>Who&apos;s booking</SectionLabel>
                <div className="space-y-4">
                  <FormField
                    control={form.control}
                    name="playerName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Name <span style={{ color: "var(--color-error)" }}>*</span>
                        </FormLabel>
                        <div className="relative">
                          <User className={iconPrefix} style={mutedIcon} />
                          <FormControl>
                            <Input
                              placeholder="e.g., Juan dela Cruz"
                              className="h-11 pl-9"
                              autoComplete="name"
                              maxLength={100}
                              {...field}
                            />
                          </FormControl>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Email <span style={{ color: "var(--color-error)" }}>*</span>
                        </FormLabel>
                        <div className="relative">
                          <Mail className={iconPrefix} style={mutedIcon} />
                          <FormControl>
                            <Input
                              type="email"
                              inputMode="email"
                              placeholder="e.g., juan@example.com"
                              className="h-11 pl-9"
                              autoComplete="email"
                              maxLength={255}
                              {...field}
                            />
                          </FormControl>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
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

                {payOnline && (
                  <>
                    <div className="mt-5">
                      <SectionLabel>How you&apos;ll pay</SectionLabel>
                    </div>
                    <div className="grid grid-cols-2 gap-2" role="group" aria-label="How you'll pay">
                      <Chip
                        selected={payMethod === "Online"}
                        onClick={() => handlePickPayMethod("Online")}
                        className="flex items-center gap-2 px-3 py-3 text-left"
                      >
                        <CreditCard className="size-4.5 shrink-0" />
                        <span style={{ fontSize: 13.5, fontWeight: 600 }}>Pay now</span>
                      </Chip>
                      <Chip
                        selected={payMethod === "Desk"}
                        onClick={() => handlePickPayMethod("Desk")}
                        className="flex items-center gap-2 px-3 py-3 text-left"
                      >
                        <Store className="size-4.5 shrink-0" />
                        <span style={{ fontSize: 13.5, fontWeight: 600 }}>At the desk</span>
                      </Chip>
                    </div>
                  </>
                )}

                <div
                  className="mt-3 flex items-start gap-2.5 p-3"
                  style={{
                    background: "var(--color-surface-sunken)",
                    border: "1px solid var(--color-line)",
                    borderRadius: 12,
                    fontSize: 13,
                    color: "var(--color-text-dark)",
                  }}
                >
                  {payMethod === "Online" ? (
                    <>
                      <CreditCard
                        className="size-4.5 shrink-0 mt-0.5"
                        style={{ color: "var(--color-text-secondary)" }}
                      />
                      <span>
                        Pay {formatPeso(picked.price)} with GCash, Maya or a card on Xendit&apos;s secure page. We
                        hold the court for {page.rules.onlineHoldMinutes} minutes while you pay. Cancel up to{" "}
                        {page.rules.cancelCutoffHours} hours before for a full refund.
                      </span>
                    </>
                  ) : (
                    <>
                      <Store
                        className="size-4.5 shrink-0 mt-0.5"
                        style={{ color: "var(--color-text-secondary)" }}
                      />
                      <span>
                        Pay {formatPeso(picked.price)} at the front desk to confirm. We hold the court for you
                        until {picked.start.subtract(holdMinutes, "minute").format("h:mm A")}
                        {picked.start.isSame(dates[0]?.day, "day") ? " today" : ` on ${picked.start.format("MMM D")}`}
                        ; after that it&apos;s released.
                      </span>
                    </>
                  )}
                </div>

                <Button type="submit" size="lg" className="w-full mt-5 h-12" disabled={isBooking}>
                  {isBooking ? <Loader2 className="animate-spin" /> : <CalendarCheck />}
                  {payMethod === "Online"
                    ? `Book ${picked.courtName}, pay ${formatPeso(picked.price)} now`
                    : `Book ${picked.courtName}, pay at the desk`}
                </Button>
              </form>
            </Form>
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
