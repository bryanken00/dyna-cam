import { useState } from "react";
import dayjs from "dayjs";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import PickChip from "./PickChip";

const DATE = "YYYY-MM-DD";
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/** The Monday of `date`'s week (weeks run Monday to Sunday). */
const mondayOf = (date) => {
  const d = dayjs(date);
  return d.subtract((d.day() + 6) % 7, "day");
};

/** "November 2026", or "Nov – Dec 2026" when a week spans two months. */
const weekLabel = (start) => {
  const end = start.add(6, "day");
  if (start.month() === end.month()) return start.format("MMMM YYYY");
  if (start.year() === end.year()) return `${start.format("MMM")} – ${end.format("MMM YYYY")}`;
  return `${start.format("MMM YYYY")} – ${end.format("MMM YYYY")}`;
};

const ArrowButton = ({ label, disabled, onClick, children }) => (
  <Button
    type="button"
    variant="outline"
    size="icon"
    aria-label={label}
    disabled={disabled}
    onClick={onClick}
    className="size-9 shrink-0"
  >
    {children}
  </Button>
);

/** The month view in the Calendar popover: past and closed days can't be picked. */
const MonthCalendar = ({ date, today, isOpenDay, onPick }) => {
  const [month, setMonth] = useState(() => dayjs(date || today).startOf("month"));
  const first = mondayOf(month);
  const days = Array.from({ length: 42 }, (_, i) => first.add(i, "day"));
  const weeks = days[35].month() === month.month() ? 6 : 5;
  const atFirstMonth = !month.isAfter(dayjs(today).startOf("month"));

  return (
    <div className="w-70">
      <div className="flex items-center justify-between mb-2">
        <ArrowButton label="Previous month" disabled={atFirstMonth} onClick={() => setMonth(month.subtract(1, "month"))}>
          <ChevronLeft />
        </ArrowButton>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-dark)" }}>
          {month.format("MMMM YYYY")}
        </span>
        <ArrowButton label="Next month" onClick={() => setMonth(month.add(1, "month"))}>
          <ChevronRight />
        </ArrowButton>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((w) => (
          <span key={w} style={{ fontSize: 11, color: "var(--color-text-muted)" }} className="py-1">
            {w}
          </span>
        ))}
        {days.slice(0, weeks * 7).map((d) => {
          const value = d.format(DATE);
          const inMonth = d.month() === month.month();
          const disabled = value < today || !isOpenDay(d);
          const selected = value === date;
          return (
            <button
              key={value}
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              aria-label={`${d.format("dddd, MMMM D")}${disabled && value >= today ? " (closed)" : ""}`}
              onClick={() => onPick(value)}
              className="h-9 rounded-lg transition-colors disabled:cursor-not-allowed hover:bg-(--color-surface-sunken)"
              style={{
                fontSize: 13.5,
                fontWeight: selected || value === today ? 600 : 400,
                border: `1px solid ${selected ? "var(--color-text-dark)" : "transparent"}`,
                background: selected ? "var(--color-surface-sunken)" : "transparent",
                color: disabled ? "var(--color-text-muted)" : "var(--color-text-dark)",
                opacity: disabled ? 0.45 : inMonth ? 1 : 0.6,
                textDecoration: value === today ? "underline" : "none",
                textUnderlineOffset: 3,
              }}
            >
              {d.format("D")}
            </button>
          );
        })}
      </div>
    </div>
  );
};

/**
 * CR-048: the player's date picker (book a court, move a booking) now that any
 * day ahead can be booked — one week at a time (Monday to Sunday) with ‹ › and
 * a Calendar button that opens a month view to jump further. Past days and the
 * venue's closed weekdays can't be picked. Props: `{ date, today, openDays, onPick }`
 * (`openDays`: weekday numbers, 0 = Sunday).
 */
const BookingDatePicker = ({ date, today, openDays, onPick }) => {
  const open = new Set(openDays || []);
  const isOpenDay = (d) => open.has(d.day());

  // The week shown follows the picked date; ‹ › move it without picking
  const [view, setView] = useState(() => ({ date, start: mondayOf(date || today) }));
  if (view.date !== date) setView({ date, start: mondayOf(date || today) });
  const start = view.start;
  const showWeek = (next) => setView({ date, start: next });

  const [calendarOpen, setCalendarOpen] = useState(false);
  const atFirstWeek = !start.isAfter(mondayOf(today));

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-dark)" }}>
          {weekLabel(start)}
        </span>
        <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm">
              <CalendarDays />
              Calendar
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto p-3">
            <MonthCalendar
              date={date}
              today={today}
              isOpenDay={isOpenDay}
              onPick={(value) => {
                onPick(value);
                setCalendarOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2">
        <ArrowButton label="Previous week" disabled={atFirstWeek} onClick={() => showWeek(start.subtract(7, "day"))}>
          <ChevronLeft />
        </ArrowButton>
        <div className="grid grid-cols-7 gap-1 sm:gap-2 flex-1 min-w-0">
          {Array.from({ length: 7 }, (_, i) => start.add(i, "day")).map((d) => {
            const value = d.format(DATE);
            const past = value < today;
            const closed = !isOpenDay(d);
            return (
              <PickChip
                key={value}
                selected={value === date}
                disabled={past || closed}
                onClick={() => onPick(value)}
                label={d.format("dddd, MMMM D")}
                className="w-full min-w-0 py-2 flex flex-col items-center"
              >
                <span style={{ fontSize: 11.5, color: "var(--color-text-secondary)" }}>
                  {value === today ? "Today" : d.format("ddd")}
                </span>
                <span style={{ fontSize: 17, fontWeight: 600 }}>{d.format("D")}</span>
                <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                  {closed && !past ? "Closed" : d.format("MMM")}
                </span>
              </PickChip>
            );
          })}
        </div>
        <ArrowButton label="Next week" onClick={() => showWeek(start.add(7, "day"))}>
          <ChevronRight />
        </ArrowButton>
      </div>
    </div>
  );
};

export default BookingDatePicker;
