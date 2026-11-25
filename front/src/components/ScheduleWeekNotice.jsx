import { Link } from "react-router";
import dayjs from "dayjs";
import { CalendarCheck, CalendarClock, CalendarX } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * CR-043: where a venue's weekly schedule stands, with Confirm next week. A week
 * runs Monday to Sunday; players book online only inside confirmed weeks.
 *
 * `schedule` = { confirmedUntil, nextWeekStart, nextWeekEnd, daysLeft, level } from
 * the API, level "due" (plain), "soon" (fewer than 3 days: warning), "closed" (this
 * week isn't confirmed: online booking is closed now, red) or "ok" (Setup only).
 *
 * Props: `schedule`; `venueName` (the Dashboard names the venue); `reviewTo` (a
 * link to the venue's hours); `canConfirm`, `isConfirming`, `onConfirm`; `onUndo`,
 * `isUndoing` (Setup: Undo confirmation, offered while `schedule.nextWeekBookings`
 * is 0 — the API checks again).
 */
const TONES = {
  due: { color: "var(--color-link)", icon: CalendarClock },
  soon: { color: "var(--color-warning)", icon: CalendarClock },
  closed: { color: "var(--color-error)", icon: CalendarX },
  ok: { color: "var(--color-success)", icon: CalendarCheck },
};

const day = (date) => dayjs(date).format("ddd, MMM D");
const span = (start, end) => `${dayjs(start).format("MMM D")} – ${dayjs(end).format("MMM D")}`;
const daysText = (n) => `${n} day${n === 1 ? "" : "s"}`;

const wording = (schedule, venueName) => {
  const week = span(schedule.nextWeekStart, schedule.nextWeekEnd);
  const at = venueName ? `${venueName} · ` : "";
  switch (schedule.level) {
    case "closed":
      return {
        title: "Online booking is closed this week",
        body: `${at}This week's schedule wasn't confirmed, so players can't book online. Confirm to open this week and next (to ${day(schedule.nextWeekEnd)}).`,
      };
    case "soon":
      return {
        title: `Only ${daysText(schedule.daysLeft)} left to confirm next week`,
        body: `${at}Players can't book ${week} online until you confirm its hours and prices.`,
      };
    case "due":
      return {
        title: "Confirm next week's schedule",
        body: `${at}Players can book ${week} online once you confirm its hours and prices. ${daysText(schedule.daysLeft)} left.`,
      };
    default: {
      const booked = schedule.nextWeekBookings || 0;
      const stays =
        booked > 0
          ? ` Next week has ${booked} booking${booked === 1 ? "" : "s"}, so it stays confirmed.`
          : "";
      return {
        title: `Confirmed through ${day(schedule.confirmedUntil)}`,
        body: `${at}Players can book online up to then. The week after can be confirmed from ${day(schedule.nextWeekStart)}.${stays}`,
      };
    }
  }
};

const ScheduleWeekNotice = ({
  schedule,
  venueName,
  reviewTo,
  canConfirm = false,
  isConfirming = false,
  onConfirm,
  isUndoing = false,
  onUndo,
}) => {
  const tone = TONES[schedule.level] || TONES.due;
  const Icon = tone.icon;
  const { title, body } = wording(schedule, venueName);
  const due = schedule.level !== "ok";
  // Next week confirmed and nobody has booked it yet → it can be taken back
  const canUndo = !due && canConfirm && !!onUndo && (schedule.nextWeekBookings ?? 0) === 0;

  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3"
      style={{
        borderRadius: "var(--radius-card)",
        border: `1px solid color-mix(in srgb, ${tone.color} ${due ? 45 : 30}%, transparent)`,
        background: `color-mix(in srgb, ${tone.color} ${due ? 9 : 6}%, transparent)`,
      }}
      role={schedule.level === "closed" || schedule.level === "soon" ? "alert" : undefined}
    >
      <div className="flex items-start gap-3 min-w-0 flex-1" style={{ flexBasis: 280 }}>
        <Icon
          className="w-4.5 h-4.5 shrink-0 mt-0.5"
          strokeWidth={1.9}
          style={{ color: tone.color }}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="m-0" style={{ fontSize: 13.5, fontWeight: 600, color: "var(--color-text-dark)" }}>
            {title}
          </p>
          <p className="m-0 mt-0.5" style={{ fontSize: 12.5, color: "var(--color-text-secondary)" }}>
            {body}
          </p>
        </div>
      </div>
      {due && (reviewTo || canConfirm) && (
        <div className="flex items-center gap-2 shrink-0">
          {reviewTo && (
            <Button variant="outline" size="sm" asChild>
              <Link to={reviewTo}>Review hours</Link>
            </Button>
          )}
          {canConfirm && (
            <Button size="sm" onClick={onConfirm} disabled={isConfirming}>
              {isConfirming ? "Confirming…" : "Confirm next week"}
            </Button>
          )}
        </div>
      )}
      {canUndo && (
        <Button variant="outline" size="sm" className="shrink-0" onClick={onUndo} disabled={isUndoing}>
          {isUndoing ? "Undoing…" : "Undo confirmation"}
        </Button>
      )}
    </div>
  );
};

export default ScheduleWeekNotice;
