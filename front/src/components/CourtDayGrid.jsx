import { useEffect, useRef } from "react";
import dayjs from "dayjs";
import { Plus } from "lucide-react";
import { decodeHTML } from "../utils/decode-html";
import {
  BOARD_TONE,
  BOOKING_STATUS_LABEL,
  formatHour,
  formatPayCode,
  formatTimeRange,
  manilaNow,
} from "../utils/dynaCam";

const LABEL_WIDTH = 150;
const HOUR_WIDTH = 72;
const ROW_HEIGHT = 56;
const DEFAULT_RANGE = { from: 6, to: 22 };
// CR-031: today opens with this share of the visible hours before the now line
const NOW_LEAD = 1 / 3;

/** CR-031: the court column stays put while the hours scroll under it. */
const stickyLabel = {
  position: "sticky",
  left: 0,
  zIndex: 4, // above the blocks (2) and the now line (3)
  background: "var(--color-surface)",
};

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

/**
 * CR-038: on the TV display a block says only what's happening — never who
 * booked or their code (a closure's reason stays off too).
 */
const displayBookingLabel = (status) =>
  status === "CheckedIn" ? "In play" : status === "Completed" ? "Played" : "Booked";

const displayBookingBar = (status) =>
  status === "CheckedIn" ? BOARD_TONE.playing : status === "Completed" ? BOARD_TONE.done : BOARD_TONE.booked;

/** "11:00–12:00" — short enough for an hour's block on the TV. */
const shortRange = (startAt, endAt) => `${dayjs(startAt).format("h:mm")}–${dayjs(endAt).format("h:mm")}`;

const Block = ({ left, width, bar, title, subtitle, onClick, hatched, tooltip, big = false }) => {
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
        padding: big ? "8px 10px" : "4px 8px",
        borderRadius: big ? 12 : 8,
        border: "1px solid var(--color-line)",
        borderLeft: `${big ? 6 : 3}px solid ${bar}`,
        background: hatched
          ? "repeating-linear-gradient(135deg, var(--color-surface-sunken) 0 6px, var(--color-surface) 6px 12px)"
          : "var(--color-surface-raised)",
        zIndex: 2,
      }}
    >
      <div
        className={big ? "line-clamp-2 break-words" : "truncate"}
        style={{ fontSize: big ? 18 : 12.5, fontWeight: 600, lineHeight: 1.2, color: "var(--color-text-dark)" }}
      >
        {title}
      </div>
      {subtitle && (
        <div
          className={big ? "mt-1 line-clamp-2 break-words" : "truncate"}
          style={{ fontSize: big ? 14.5 : 11.5, color: "var(--color-text-muted)" }}
        >
          {subtitle}
        </div>
      )}
    </Tag>
  );
};

/**
 * One day at a venue: a row per court, a column per hour. Bookings, games and
 * closures are blocks; a free future hour opens New booking. CR-031: the court
 * column is sticky, and each new day on screen (venue + date) scrolls today to
 * the current time, other days to their first hour.
 *
 * Shared by Admin → Bookings (Day) and the public TV board (pages/Public/Board).
 *
 * CR-038: `display` draws it for the venue's TV — the hours fit the width and
 * the courts fill the height (no scrolling), large type, nothing clickable,
 * no names, codes or closure reasons, and each court says what's on it now.
 */
const CourtDayGrid = ({ day, canWrite, onCellClick, onBookingClick, display = false }) => {
  const scrollRef = useRef(null);
  // The day actually drawn — not the picked one: while the next day loads the
  // previous stays on screen, and the scroll waits for the new one
  const scrollKey = `${day.date}|${day.courts.map((c) => c.courtId).join(",")}`;
  const { from, to } = hourRange(day);
  const hours = Array.from({ length: to - from }, (_, i) => from + i);
  const span = (to - from) * 60;
  const now = manilaNow();
  const nowMinute =
    now.date === day.date ? hourOf(now.time) * 60 + Number(now.time.slice(3, 5)) : null;
  const isPastDay = day.date < now.date;

  const labelWidth = display ? 250 : LABEL_WIDTH;

  // Scroll once per venue + date — never on a refetch, so it doesn't move under the user
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || display) return;
    if (nowMinute === null || nowMinute < from * 60 || nowMinute > to * 60) {
      el.scrollLeft = 0;
      return;
    }
    const timeline = el.scrollWidth - LABEL_WIDTH;
    const visible = el.clientWidth - LABEL_WIDTH;
    const nowX = ((nowMinute - from * 60) / span) * timeline;
    el.scrollLeft = Math.max(0, nowX - visible * NOW_LEAD);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new venue / date scrolls
  }, [scrollKey]);

  const position = (startAt, endAt) => {
    const start = minuteOfDay(startAt, day.date);
    const end = minuteOfDay(endAt, day.date);
    return {
      left: ((start - from * 60) / span) * 100,
      width: (Math.max(15, end - start) / span) * 100,
    };
  };

  // CR-038: what's on a court now, for the TV's court column
  const courtNow = (bookings, games, closures) => {
    if (nowMinute === null) return null;
    const at = (item) => ({
      start: minuteOfDay(item.startAt, day.date),
      end: minuteOfDay(item.endAt, day.date),
    });
    const until = (item) => dayjs(item.endAt).format("h:mm A");
    const playing = games.find((g) => g.status === "Recording");
    if (playing) return { text: playing.openEnded ? "In play" : `In play until ${until(playing)}`, tone: BOARD_TONE.playing };
    for (const b of bookings) {
      const { start, end } = at(b);
      if (start <= nowMinute && nowMinute < end) {
        return b.status === "CheckedIn"
          ? { text: `In play until ${until(b)}`, tone: BOARD_TONE.playing }
          : { text: `Booked until ${until(b)}`, tone: BOARD_TONE.booked };
      }
    }
    for (const c of closures) {
      const { start, end } = at(c);
      if (start <= nowMinute && nowMinute < end) return { text: `Closed until ${until(c)}`, tone: BOARD_TONE.done };
    }
    const next = [...bookings, ...games, ...closures]
      .map((item) => ({ item, ...at(item) }))
      .filter(({ start }) => start > nowMinute)
      .sort((a, b) => a.start - b.start)[0];
    return {
      text: next ? `Free until ${dayjs(next.item.startAt).format("h:mm A")}` : "Free",
      tone: BOARD_TONE.free,
    };
  };

  return (
    <div ref={scrollRef} className={display ? "h-full flex flex-col" : "overflow-x-auto"}>
      <div
        className={display ? "flex-1 flex flex-col min-h-0" : undefined}
        style={display ? undefined : { minWidth: LABEL_WIDTH + hours.length * HOUR_WIDTH }}
      >
        {/* Hour labels */}
        <div className="flex shrink-0" style={{ borderBottom: "1px solid var(--color-line)" }}>
          <div className="shrink-0" style={{ width: labelWidth, ...stickyLabel }} />
          <div className="flex-1 grid" style={{ gridTemplateColumns: `repeat(${hours.length}, 1fr)` }}>
            {hours.map((h) => (
              <div
                key={h}
                className={display ? "px-2 py-3" : "px-1.5 py-2"}
                style={{
                  fontSize: display ? 16 : 11.5,
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
              className={display ? "flex flex-1" : "flex"}
              style={{
                borderBottom: "1px solid var(--color-line)",
                ...(display ? { minHeight: 84, maxHeight: 200 } : { height: ROW_HEIGHT }),
              }}
            >
              <div
                className={`shrink-0 flex flex-col justify-center ${display ? "px-6 gap-1" : "px-4"}`}
                style={{ width: labelWidth, borderRight: "1px solid var(--color-line)", ...stickyLabel }}
              >
                <span
                  className="truncate"
                  style={{ fontSize: display ? 26 : 13.5, fontWeight: display ? 600 : 500, color: "var(--color-text-dark)" }}
                >
                  {decodeHTML(court.name)}
                </span>
                {inactive && (
                  <span style={{ fontSize: display ? 15 : 11.5, color: "var(--color-text-muted)" }}>Inactive</span>
                )}
                {display && !inactive && (() => {
                  const status = courtNow(bookings, games, closures);
                  return status ? (
                    <span className="inline-flex items-center gap-2 truncate" style={{ fontSize: 16, color: "var(--color-text-secondary)" }}>
                      <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: status.tone }} />
                      {status.text}
                    </span>
                  ) : null;
                })()}
              </div>

              <div className="relative flex-1">
                {/* Free hours */}
                <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${hours.length}, 1fr)` }}>
                  {hours.map((h) => {
                    const past = isPastDay || (nowMinute !== null && (h + 1) * 60 <= nowMinute);
                    const bookable = !display && canWrite && !past && !inactive;
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
                    big={display}
                    title="Closed"
                    subtitle={display ? shortRange(c.startAt, c.endAt) : decodeHTML(c.reason) || formatTimeRange(c.startAt, c.endAt)}
                    tooltip={display ? undefined : `Closed ${formatTimeRange(c.startAt, c.endAt)}`}
                  />
                ))}

                {games.map((g) => (
                  <Block
                    key={g.sessionId}
                    {...position(g.startAt, g.endAt)}
                    bar={
                      !display
                        ? "var(--color-info)"
                        : g.status === "Recording"
                          ? BOARD_TONE.playing
                          : isPastDay || (nowMinute !== null && minuteOfDay(g.endAt, day.date) <= nowMinute)
                            ? BOARD_TONE.done
                            : BOARD_TONE.booked
                    }
                    big={display}
                    title={
                      display
                        ? g.status === "Recording"
                          ? "In play"
                          : isPastDay || (nowMinute !== null && minuteOfDay(g.endAt, day.date) <= nowMinute)
                            ? "Played"
                            : "Booked"
                        : g.status === "Recording"
                          ? "Game · recording"
                          : "Game"
                    }
                    subtitle={display ? shortRange(g.startAt, g.endAt) : decodeHTML(g.playerName) || formatTimeRange(g.startAt, g.endAt)}
                    tooltip={display ? undefined : `Game ${formatTimeRange(g.startAt, g.endAt)}${g.openEnded ? " (no end time)" : ""}`}
                  />
                ))}

                {bookings.map((b) => (
                  <Block
                    key={b.bookingId}
                    {...position(b.startAt, b.endAt)}
                    bar={display ? displayBookingBar(b.status) : BAR[b.status] || "var(--color-text-muted)"}
                    big={display}
                    // CR-038: the TV never shows who booked or their code
                    title={display ? displayBookingLabel(b.status) : decodeHTML(b.playerName)}
                    subtitle={
                      display
                        ? shortRange(b.startAt, b.endAt)
                        : `${formatPayCode(b.bookingCode)} · ${BOOKING_STATUS_LABEL[b.status] || b.status}`
                    }
                    tooltip={display ? undefined : `${decodeHTML(b.playerName)} · ${formatTimeRange(b.startAt, b.endAt)}`}
                    onClick={display ? undefined : () => onBookingClick(b.bookingId)}
                  />
                ))}

                {/* Now */}
                {nowMinute !== null && nowMinute >= from * 60 && nowMinute <= to * 60 && (
                  <div
                    aria-hidden
                    className="absolute top-0 bottom-0"
                    style={{
                      left: `${((nowMinute - from * 60) / span) * 100}%`,
                      width: display ? 3 : 2,
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

export default CourtDayGrid;
