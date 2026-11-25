import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import SetupSection from "../../CourtSetup/components/SetupSection";
import DescriptionList from "../../../../../components/DescriptionList";
import ScheduleWeekNotice from "../../../../../components/ScheduleWeekNotice";
import { decodeHTML } from "../../../../../utils/decode-html";
import {
  WEEKDAY_NAMES,
  WEEK_ORDER,
  formatDays,
  formatHour,
  formatMinutes,
  formatPeso,
} from "../../../../../utils/dynaCam";

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
 * rates; Edit opens BookingSettingsFormDrawer. CR-043: with online booking on,
 * how far the weekly schedule is confirmed, Confirm next week, and Undo while
 * nobody has booked next week.
 */
const BookingRulesSection = ({
  settings,
  canWrite,
  onEdit,
  isConfirmingWeek = false,
  onConfirmWeek,
  isUnconfirmingWeek = false,
  onUnconfirmWeek,
}) => {
  const byDay = new Map(settings.hours.map((h) => [h.dayOfWeek, h]));

  return (
    <SetupSection
      id="booking-rules"
      title="Booking rules, hours and prices"
      description="Bookings are whole hours inside opening hours. Each hour costs the rate that covers it. Players book online one confirmed week at a time."
      aside={
        canWrite && (
          <Button type="button" variant="outline" size="sm" onClick={onEdit}>
            <Pencil />
            Edit
          </Button>
        )
      }
    >
      {settings.bookingEnabled && settings.schedule && (
        <div className="mb-6">
          <ScheduleWeekNotice
            schedule={settings.schedule}
            canConfirm={canWrite}
            isConfirming={isConfirmingWeek}
            onConfirm={onConfirmWeek}
            isUndoing={isUnconfirmingWeek}
            onUndo={onUnconfirmWeek}
          />
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <div>
          <Heading>Rules</Heading>
          <DescriptionList
            items={[
              { label: "Longest booking", value: formatMinutes(settings.maxBookingMinutes) },
              {
                label: "Book up to",
                value: `${settings.bookingDaysAhead} days ahead, in confirmed weeks`,
              },
              {
                label: "Pay at the desk by",
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
