import dayjs from "dayjs";
import { Plus } from "lucide-react";
import { decodeHTML } from "../../../../../utils/decode-html";
import {
  BOOKING_STATUS_LABEL,
  formatHour,
  formatPayCode,
  formatTimeRange,
  manilaNow,
} from "../../../../../utils/dynaCam";

const LABEL_WIDTH = 150;
const HOUR_WIDTH = 72;
const ROW_HEIGHT = 56;
const DEFAULT_RANGE = { from: 6, to: 22 };

/** Booking status → the block's left bar. Tokens only. */
const BAR = {
  Pending: "var(--color-warning)",
  Confirmed: "var(--color-success)",
  CheckedIn: "var(--color-success)",
  Completed: "var(--color-text-muted)",
  NoShow: "var(--color-error)",
};

const hourOf = (hhmm) => Number(String(hhmm).slice(0, 2));

/** Minutes since the day's 00:00 for a "YYYY-MM-DD HH:mm:ss" on `date` (clamped to the day). */
const minuteOfDay = (local, date) => {
  const d = dayjs(local);
  const start = dayjs(`${date} 00:00:00`);
  return Math.max(0, Math.min(1440, d.diff(start, "minute")));
};

/**
 * The hours to draw: the venue's opening hours that day (or 6 AM – 10 PM when
 * closed), widened to fit anything on the timeline outside them.
 */
const hourRange = (day) => {
  let from = day.hours ? hourOf(day.hours.opensAt) : DEFAULT_RANGE.from;
  let to = day.hours ? hourOf(day.hours.closesAt) : DEFAULT_RANGE.to;
  for (const item of [...day.bookings, ...day.games, ...day.closures]) {
    from = Math.min(from, Math.floor(minuteOfDay(item.startAt, day.date) / 60));
    to = Math.max(to, Math.ceil(minuteOfDay(item.endAt, day.date) / 60));
  }
  if (to <= from) to = Math.min(24, from + 1);
  return { from, to };
};

const Block = ({ left, width, bar, title, subtitle, onClick, hatched, tooltip }) => {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={tooltip}
      className={`absolute text-left overflow-hidden ${onClick ? "cursor-pointer hover:brightness-95" : ""}`}
      style={{
        top: 4,
        bottom: 4,
        left: `${left}%`,
        width: `calc(${width}% - 3px)`,
        padding: "4px 8px",
        borderRadius: 8,
        border: "1px solid var(--color-line)",
        borderLeft: `3px solid ${bar}`,
        background: hatched
          ? "repeating-linear-gradient(135deg, var(--color-surface-sunken) 0 6px, var(--color-surface) 6px 12px)"
          : "var(--color-surface-raised)",
        zIndex: 2,
      }}
    >
      <div className="truncate" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text-dark)" }}>
        {title}
      </div>
      {subtitle && (
        <div className="truncate" style={{ fontSize: 11.5, color: "var(--color-text-muted)" }}>
          {subtitle}
        </div>
      )}
    </Tag>
  );
};

/**
 * One day at a venue: a row per court, a column per hour. Bookings, games and
 * closures are blocks; a free future hour opens New booking.
 */
const DayGrid = ({ day, canWrite, onCellClick, onBookingClick }) => {
  const { from, to } = hourRange(day);
  const hours = Array.from({ length: to - from }, (_, i) => from + i);
  const span = (to - from) * 60;
  const now = manilaNow();
  const nowMinute =
    now.date === day.date ? hourOf(now.time) * 60 + Number(now.time.slice(3, 5)) : null;
  const isPastDay = day.date < now.date;

  const position = (startAt, endAt) => {
    const start = minuteOfDay(startAt, day.date);
    const end = minuteOfDay(endAt, day.date);
    return {
      left: ((start - from * 60) / span) * 100,
      width: (Math.max(15, end - start) / span) * 100,
    };
  };

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: LABEL_WIDTH + hours.length * HOUR_WIDTH }}>
        {/* Hour labels */}
        <div className="flex" style={{ borderBottom: "1px solid var(--color-line)" }}>
          <div className="shrink-0" style={{ width: LABEL_WIDTH }} />
          <div className="flex-1 grid" style={{ gridTemplateColumns: `repeat(${hours.length}, 1fr)` }}>
            {hours.map((h) => (
              <div
                key={h}
                className="px-1.5 py-2"
                style={{
                  fontSize: 11.5,
                  color: "var(--color-text-muted)",
                  borderLeft: "1px solid var(--color-line-soft)",
                }}
              >
                {formatHour(`${String(h).padStart(2, "0")}:00`)}
              </div>
            ))}
          </div>
        </div>

        {/* A row per court */}
        {day.courts.map((court) => {
          const bookings = day.bookings.filter((b) => b.courtId === court.courtId);
          const games = day.games.filter((g) => g.courtId === court.courtId && !g.bookingId);
          const closures = day.closures.filter((c) => !c.courtId || c.courtId === court.courtId);
          const inactive = court.status !== "Active";

          return (
            <div
              key={court.courtId}
              className="flex"
              style={{ borderBottom: "1px solid var(--color-line)", height: ROW_HEIGHT }}
            >
              <div
                className="shrink-0 flex flex-col justify-center px-4"
                style={{ width: LABEL_WIDTH, borderRight: "1px solid var(--color-line)" }}
              >
                <span className="truncate" style={{ fontSize: 13.5, fontWeight: 500, color: "var(--color-text-dark)" }}>
                  {decodeHTML(court.name)}
                </span>
                {inactive && (
                  <span style={{ fontSize: 11.5, color: "var(--color-text-muted)" }}>Inactive</span>
                )}
              </div>

              <div className="relative flex-1">
                {/* Free hours */}
                <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${hours.length}, 1fr)` }}>
                  {hours.map((h) => {
                    const past = isPastDay || (nowMinute !== null && (h + 1) * 60 <= nowMinute);
                    const bookable = canWrite && !past && !inactive;
                    return bookable ? (
                      <button
                        key={h}
                        type="button"
                        aria-label={`New booking on ${decodeHTML(court.name)} at ${formatHour(`${String(h).padStart(2, "0")}:00`)}`}
                        onClick={() => onCellClick(court.courtId, `${String(h).padStart(2, "0")}:00`)}
                        className="group flex items-center justify-center cursor-pointer transition-colors hover:bg-(--color-surface-sunken)"
                        style={{ borderLeft: "1px solid var(--color-line-soft)" }}
                      >
                        <Plus
                          className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{ color: "var(--color-text-muted)" }}
                        />
                      </button>
                    ) : (
                      <div
                        key={h}
                        style={{
                          borderLeft: "1px solid var(--color-line-soft)",
                          background: past ? "var(--color-surface-sunken)" : "transparent",
                        }}
                      />
                    );
                  })}
                </div>

                {closures.map((c) => (
                  <Block
                    key={c.closureId}
                    {...position(c.startAt, c.endAt)}
                    bar="var(--color-text-muted)"
                    hatched
                    title="Closed"
                    subtitle={decodeHTML(c.reason) || formatTimeRange(c.startAt, c.endAt)}
                    tooltip={`Closed ${formatTimeRange(c.startAt, c.endAt)}`}
                  />
                ))}

                {games.map((g) => (
                  <Block
                    key={g.sessionId}
                    {...position(g.startAt, g.endAt)}
                    bar="var(--color-info)"
                    title={g.status === "Recording" ? "Game · recording" : "Game"}
                    subtitle={decodeHTML(g.playerName) || formatTimeRange(g.startAt, g.endAt)}
                    tooltip={`Game ${formatTimeRange(g.startAt, g.endAt)}${g.openEnded ? " (no end time)" : ""}`}
                  />
                ))}

                {bookings.map((b) => (
                  <Block
                    key={b.bookingId}
                    {...position(b.startAt, b.endAt)}
                    bar={BAR[b.status] || "var(--color-text-muted)"}
                    title={decodeHTML(b.playerName)}
                    subtitle={`${formatPayCode(b.bookingCode)} · ${BOOKING_STATUS_LABEL[b.status] || b.status}`}
                    tooltip={`${decodeHTML(b.playerName)} · ${formatTimeRange(b.startAt, b.endAt)}`}
                    onClick={() => onBookingClick(b.bookingId)}
                  />
                ))}

                {/* Now */}
                {nowMinute !== null && nowMinute >= from * 60 && nowMinute <= to * 60 && (
                  <div
                    aria-hidden
                    className="absolute top-0 bottom-0"
                    style={{
                      left: `${((nowMinute - from * 60) / span) * 100}%`,
                      width: 2,
                      background: "var(--color-error)",
                      zIndex: 3,
                    }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default DayGrid;
