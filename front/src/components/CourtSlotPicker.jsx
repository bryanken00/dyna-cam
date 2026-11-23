import PickChip from "./PickChip";
import Spinner from "./Spinner";
import { decodeHTML } from "../utils/decode-html";
import { formatHour, formatMinutes, formatPeso } from "../utils/dynaCam";

/**
 * PLAN-003: each court's start times for a day, with prices — the grid on the
 * player's booking pages (book a court; Phase H: move a booking, where the
 * booking's own time is marked "Yours").
 *
 * Props: `{ availability, loading, error, durationMinutes, slot, onPick,
 *   unavailableLabel?, emptyHint? }` — availability: `{ hours, courts: [{ key, name,
 *   slots: [{ startTime, available, price, current? }] }] }`; slot: `{ courtKey, startTime }`.
 */
const CourtSlotPicker = ({
  availability,
  loading,
  error,
  durationMinutes,
  slot,
  onPick,
  unavailableLabel = "Taken",
  emptyHint,
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
            <div className="grid grid-cols-3 gap-2">
              {court.slots.map((s) => (
                <PickChip
                  key={s.startTime}
                  selected={
                    s.current ||
                    (slot?.courtKey === court.key &&
                      slot?.startTime === s.startTime)
                  }
                  disabled={!s.available}
                  onClick={() => onPick(court.key, s.startTime)}
                  label={`${decodeHTML(court.name)} at ${formatHour(s.startTime)}${
                    s.current
                      ? ", your booking"
                      : s.available
                        ? ""
                        : `, ${unavailableLabel.toLowerCase()}`
                  }`}
                  className="py-2 flex flex-col items-center"
                >
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      textDecoration:
                        s.available || s.current ? "none" : "line-through",
                    }}
                  >
                    {formatHour(s.startTime)}
                  </span>
                  <span
                    style={{ fontSize: 11.5, color: "var(--color-text-muted)" }}
                  >
                    {s.current
                      ? "Yours"
                      : s.available
                        ? formatPeso(s.price)
                        : unavailableLabel}
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
