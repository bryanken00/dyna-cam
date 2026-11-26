import dayjs from "dayjs";
import PickChip from "./PickChip";
import Spinner from "./Spinner";
import { decodeHTML } from "../utils/decode-html";
import { formatMinutes, formatPeso, formatSlotHour } from "../utils/dynaCam";

/** CR-049: why an hour can't be picked (from the API's `reason`) → its label. */
const REASON_LABEL = {
  taken: "Taken",
  closed: "Closed",
  past: "Past",
  noPrice: "Not open",
};

/**
 * PLAN-003: each court's start times for a day, with prices — the grid on the
 * player's booking pages (book a court; Phase H: move a booking, where the
 * booking's own time is marked "Yours").
 *
 * Props: `{ availability, loading, error, durationMinutes, slot, onPick, isPicked?,
 *   unavailableLabel?, emptyHint?, columnsClassName? }` — availability: `{ hours, courts: [{ key, name,
 *   slots: [{ startTime, available, price, current?, now? }] }] }`; slot: `{ courtKey, startTime }`.
 * CR-047: `isPicked(courtKey, startTime)` makes it a multi-pick (the booking
 * page: tap any hours on any courts); `now` marks the hour that's running.
 * CR-049: `nextDay` slots ("24:00", "25:00", …) are the evening's hours past
 * midnight — shown as "12 AM · Fri" (the weekday from `availability.date`).
 */
const CourtSlotPicker = ({
  availability,
  loading,
  error,
  durationMinutes,
  slot,
  onPick,
  isPicked,
  unavailableLabel = "Taken",
  emptyHint,
  columnsClassName = "grid-cols-3",
}) => {
  if (error) {
    return (
      <p
        className="m-0"
        style={{ fontSize: 13.5, color: "var(--color-error)" }}
      >
        {error.response?.data?.message ||
          "Couldn't load the free times. Try again."}
      </p>
    );
  }
  if (loading || !availability)
    return <Spinner className="py-8" tip="Checking free times…" />;
  if (!availability.hours) {
    return (
      <p
        className="m-0"
        style={{ fontSize: 13.5, color: "var(--color-text-muted)" }}
      >
        Closed that day — pick another date.
      </p>
    );
  }
  if (!availability.courts.some((c) => c.slots.some((s) => s.available))) {
    return (
      <p
        className="m-0"
        style={{ fontSize: 13.5, color: "var(--color-text-muted)" }}
      >
        {emptyHint ||
          `Nothing free for ${formatMinutes(durationMinutes)} that day — try another date.`}
      </p>
    );
  }

  // CR-049: "12 AM · Fri" for an hour past midnight
  const nextWeekday = availability.date ? dayjs(availability.date).add(1, "day").format("ddd") : "next day";
  const hourLabel = (s) => `${formatSlotHour(s.startTime)}${s.nextDay ? ` · ${nextWeekday}` : ""}`;
  const whyNot = (s) => REASON_LABEL[s.reason] || unavailableLabel;

  return (
    <div className="space-y-5">
      {availability.courts.map((court) => (
        <div key={court.key}>
          <div
            className="mb-2"
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--color-text-dark)",
            }}
          >
            {decodeHTML(court.name)}
          </div>
          {court.slots.some((s) => s.available || s.current) ? (
            <div className={`grid ${columnsClassName} gap-2`}>
              {court.slots.map((s) => (
                <PickChip
                  key={s.startTime}
                  selected={
                    s.current ||
                    (isPicked
                      ? isPicked(court.key, s.startTime)
                      : slot?.courtKey === court.key &&
                        slot?.startTime === s.startTime)
                  }
                  disabled={!s.available}
                  onClick={() => onPick(court.key, s.startTime)}
                  label={`${decodeHTML(court.name)} at ${hourLabel(s)}${
                    s.current
                      ? ", your booking"
                      : s.available
                        ? ""
                        : `, ${whyNot(s).toLowerCase()}`
                  }`}
                  className="py-2 flex flex-col items-center"
                >
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      // Struck through only when something's on it (taken / closed)
                      textDecoration:
                        s.available || s.current || s.reason === "past" || s.reason === "noPrice"
                          ? "none"
                          : "line-through",
                    }}
                  >
                    {hourLabel(s)}
                  </span>
                  <span
                    style={{ fontSize: 11.5, color: "var(--color-text-muted)" }}
                  >
                    {s.current
                      ? "Yours"
                      : s.available
                        ? `${s.now ? "Now · " : ""}${formatPeso(s.price)}`
                        : whyNot(s)}
                  </span>
                </PickChip>
              ))}
            </div>
          ) : (
            <p
              className="m-0"
              style={{ fontSize: 13, color: "var(--color-text-muted)" }}
            >
              Nothing free for {formatMinutes(durationMinutes)} that day.
            </p>
          )}
        </div>
      ))}
    </div>
  );
};

export default CourtSlotPicker;
