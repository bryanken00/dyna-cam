import PickChip from "./PickChip";

/**
 * PLAN-003: the row of bookable dates on the player's booking pages (book a
 * court, move a booking). Props: `{ dates: [{ date, open, day }], date, today, onPick }`
 * — `day` is a dayjs; closed days can't be picked.
 */
const BookingDateStrip = ({ dates, date, today, onPick }) => (
  <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
    {dates.map((d) => (
      <PickChip
        key={d.date}
        selected={d.date === date}
        disabled={!d.open}
        onClick={() => onPick(d.date)}
        label={d.day.format("dddd, MMMM D")}
        className="w-15 py-2 flex flex-col items-center"
      >
        <span style={{ fontSize: 11.5, color: "var(--color-text-secondary)" }}>
          {d.date === today ? "Today" : d.day.format("ddd")}
        </span>
        <span style={{ fontSize: 17, fontWeight: 600 }}>
          {d.day.format("D")}
        </span>
        <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
          {d.open ? d.day.format("MMM") : "Closed"}
        </span>
      </PickChip>
    ))}
  </div>
);

export default BookingDateStrip;
