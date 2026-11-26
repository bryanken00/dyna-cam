import { Pencil, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import SetupSection from "../../CourtSetup/components/SetupSection";
import DescriptionList from "../../../../../components/DescriptionList";
import { decodeHTML } from "../../../../../utils/decode-html";
import {
  WEEKDAY_NAMES,
  WEEKDAY_SHORT,
  WEEK_ORDER,
  formatDays,
  formatHour,
  formatMinutes,
  formatPeso,
  formatSlotHour,
  hourMinutes,
} from "../../../../../utils/dynaCam";

/**
 * CR-049: open hours no rate covers (so they can't be booked) — e.g. the late
 * hours past midnight, priced by their real day and time. → ["Mon 12 AM – 1 AM (next day)", …]
 */
const unpricedHours = (hours, rates) => {
  const covered = (weekday, minute) =>
    rates.some(
      (r) =>
        r.daysOfWeek.includes(weekday) &&
        hourMinutes(r.startTime) <= minute &&
        minute < hourMinutes(r.endTime),
    );
  const gaps = [];
  for (const day of WEEK_ORDER) {
    const h = hours.find((x) => x.dayOfWeek === day);
    if (!h) continue;
    let from = null;
    const close = hourMinutes(h.closesAt);
    for (let m = hourMinutes(h.opensAt); m <= close; m += 60) {
      const free = m < close && !covered((day + Math.floor(m / 1440)) % 7, m % 1440);
      if (free && from === null) from = m;
      if (!free && from !== null) {
        const hhmm = (x) => `${String(x / 60).padStart(2, "0")}:00`;
        gaps.push(`${WEEKDAY_SHORT[day]} ${formatSlotHour(hhmm(from))} – ${formatHour(hhmm(m))}`);
        from = null;
      }
    }
  }
  return gaps;
};

const Muted = ({ children }) => (
  <p className="m-0" style={{ fontSize: 13.5, color: "var(--color-text-muted)" }}>
    {children}
  </p>
);

const Heading = ({ children }) => (
  <h3
    className="m-0 mb-2 font-semibold"
    style={{ fontSize: 13.5, color: "var(--color-text-dark)" }}
  >
    {children}
  </h3>
);

/**
 * PLAN-003: a summary of the venue's booking rules, opening hours and hourly
 * rates; Edit opens BookingSettingsFormDrawer.
 */
const BookingRulesSection = ({ settings, canWrite, onEdit }) => {
  const byDay = new Map(settings.hours.map((h) => [h.dayOfWeek, h]));
  const gaps = settings.rates.length > 0 ? unpricedHours(settings.hours, settings.rates) : [];

  return (
    <SetupSection
      id="booking-rules"
      title="Booking rules, hours and prices"
      description="Bookings are whole hours inside opening hours. Each hour costs the rate that covers it."
      aside={
        canWrite && (
          <Button type="button" variant="outline" size="sm" onClick={onEdit}>
            <Pencil />
            Edit
          </Button>
        )
      }
    >
      {gaps.length > 0 && (
        <div
          className="mb-5 flex items-start gap-2.5 px-3.5 py-3"
          style={{ borderRadius: 10, border: "1px solid var(--color-line)", background: "var(--color-surface-sunken)" }}
        >
          <TriangleAlert className="size-4.5 shrink-0 mt-0.5" style={{ color: "var(--color-warning)" }} />
          <div style={{ fontSize: 13.5, color: "var(--color-text-dark)" }}>
            <div className="font-semibold">Some open hours have no price, so nobody can book them</div>
            <div style={{ color: "var(--color-text-secondary)" }}>
              {gaps.join(" · ")}. Add a price that covers them (hours past midnight use the next
              day&apos;s prices).
            </div>
          </div>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <div>
          <Heading>Rules</Heading>
          <DescriptionList
            items={[
              {
                label: "Pay links due",
                value: `${formatMinutes(settings.deskHoldMinutes)} before the start`,
              },
              { label: "Online payment hold", value: formatMinutes(settings.onlineHoldMinutes) },
              {
                label: "Players cancel or move until",
                value: `${settings.cancelCutoffHours} h before the start`,
              },
              {
                label: "Check in from",
                value: `${formatMinutes(settings.checkInEarlyMinutes)} before the start`,
              },
            ]}
          />
        </div>

        <div>
          <Heading>Opening hours</Heading>
          {settings.hours.length === 0 ? (
            <Muted>No opening hours yet, so nothing can be booked.</Muted>
          ) : (
            <ul className="m-0 p-0 list-none space-y-1">
              {WEEK_ORDER.map((day) => {
                const h = byDay.get(day);
                return (
                  <li
                    key={day}
                    className="flex justify-between gap-3"
                    style={{ fontSize: 13.5 }}
                  >
                    <span style={{ color: "var(--color-text-secondary)" }}>
                      {WEEKDAY_NAMES[day]}
                    </span>
                    <span style={{ color: h ? "var(--color-text-dark)" : "var(--color-text-muted)" }}>
                      {h ? `${formatHour(h.opensAt)} – ${formatHour(h.closesAt)}` : "Closed"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div>
          <Heading>Prices per hour</Heading>
          {settings.rates.length === 0 ? (
            <Muted>No rates yet, so nothing can be booked online.</Muted>
          ) : (
            <ul className="m-0 p-0 list-none space-y-2.5">
              {settings.rates.map((r) => (
                <li key={r.rateId} style={{ fontSize: 13.5 }}>
                  <div className="flex justify-between gap-3">
                    <span style={{ color: "var(--color-text-dark)", fontWeight: 500 }}>
                      {decodeHTML(r.name)}
                    </span>
                    <span style={{ color: "var(--color-text-dark)" }}>
                      {formatPeso(r.pricePerHour)}
                    </span>
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
                    {formatDays(r.daysOfWeek)} · {formatHour(r.startTime)} –{" "}
                    {formatHour(r.endTime)} ·{" "}
                    {r.courtName ? decodeHTML(r.courtName) : "All courts"}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </SetupSection>
  );
};

export default BookingRulesSection;
