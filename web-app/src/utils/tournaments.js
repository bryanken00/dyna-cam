import dayjs from "dayjs";

/** PLAN-009 phase E: words for tournaments on player pages. */

/** "Sat, Dec 12" / "Dec 12 – 13" / "Dec 30 – Jan 2". */
export const dateRange = (start, end) => {
  const a = dayjs(start);
  const b = dayjs(end);
  if (a.isSame(b, "day")) return a.format("ddd, MMM D");
  return a.isSame(b, "month") ? `${a.format("MMM D")} – ${b.format("D")}` : `${a.format("MMM D")} – ${b.format("MMM D")}`;
};

export const FORMAT_TEXT = {
  RoundRobin: "Round robin — everyone plays everyone",
  SingleElimination: "Knockout",
  RoundRobinThenKnockout: "Groups, then knockout",
};

/** A knockout round's name, counting from the final. */
export const roundName = (round, rounds) => {
  const fromEnd = rounds - round;
  return fromEnd === 0 ? "Final" : fromEnd === 1 ? "Semi-finals" : fromEnd === 2 ? "Quarter-finals" : `Round ${round}`;
};

/** A team row's last line: what's next. */
export const teamLine = (t) => {
  if (t.status === "Withdrawn") return "Withdrawn";
  if (t.status === "Pending") return t.captain && t.paymentStatus === "Unpaid" ? "Not paid yet — open to pay" : "Waiting for your partner";
  const next = t.matches.find((m) => ["Ready", "Playing", "Pending"].includes(m.status));
  if (next) {
    const when = next.scheduledAt ? ` · ${dayjs(next.scheduledAt).format("ddd h:mm A")}` : "";
    return next.status === "Playing" ? `On ${next.court} now vs ${next.opponent}` : `Next: vs ${next.opponent}${next.court ? ` on ${next.court}` : ""}${when}`;
  }
  const last = [...t.matches].reverse().find((m) => m.status === "Done");
  if (last) return `${last.won ? "Won" : "Lost"} ${last.scoreFor}–${last.scoreAgainst} vs ${last.opponent}`;
  return t.drawOut ? "The draw is out" : "Registered — waiting for the draw";
};
