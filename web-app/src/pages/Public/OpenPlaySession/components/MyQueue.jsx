import { Coffee, Hourglass, MapPin, Trophy, UserCheck } from "lucide-react";

const card = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-line)",
  borderRadius: "var(--radius-card)",
};

/** "Ana" / "Ana & Ben". */
const names = (list = []) => list.join(" & ");

/** The words for each queue state: icon, the big line, the small line. */
const describe = (q) => {
  switch (q.state) {
    case "playing":
      return {
        icon: Trophy,
        title: `You're on ${q.court}`,
        detail: `With ${names(q.partners)} vs ${names(q.opponents)}`,
        tone: "var(--color-link)",
      };
    case "next":
      return {
        icon: MapPin,
        title: q.gamesAhead ? `Up next — ${q.gamesAhead} game${q.gamesAhead === 1 ? "" : "s"} ahead` : "You're up next",
        detail: `With ${names(q.partners)} vs ${names(q.opponents)}, on the next free court`,
        tone: "var(--color-success)",
      };
    case "waiting":
      return {
        icon: Hourglass,
        title: `#${q.place} in line`,
        detail: `${q.waiting} waiting · ${q.gamesPlayed} game${q.gamesPlayed === 1 ? "" : "s"} played${q.paused ? " · the queue is paused" : ""}`,
        tone: "var(--color-text-dark)",
      };
    case "resting":
      return { icon: Coffee, title: "You're resting", detail: "Tell the desk when you're ready to play again.", tone: "var(--color-text-secondary)" };
    case "notCheckedIn":
      return { icon: UserCheck, title: "Check in at the desk", detail: "You join the line once you're checked in.", tone: "var(--color-warning)" };
    default:
      return null;
  }
};

/**
 * PLAN-009 phase D: the player's place in the queue while the session runs —
 * refreshed every 10 seconds. Props: `{ queue }` from GET /player/play/signups/:code/queue.
 */
const MyQueue = ({ queue }) => {
  const text = queue ? describe(queue) : null;
  if (!text) return null;
  const Icon = text.icon;
  return (
    <div className="p-4 flex items-center gap-3.5" style={{ ...card, borderColor: text.tone }} aria-live="polite">
      <span
        className="inline-flex items-center justify-center h-12 w-12 shrink-0"
        style={{ background: "var(--color-surface-sunken)", borderRadius: 14 }}
      >
        <Icon className="h-6 w-6" style={{ color: text.tone }} />
      </span>
      <span className="min-w-0">
        <span className="block" style={{ fontSize: 18, fontWeight: 700, color: text.tone }}>
          {text.title}
        </span>
        <span className="block" style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}>
          {text.detail}
        </span>
      </span>
    </div>
  );
};

export default MyQueue;
