import { decodeHTML } from "../../../../utils/decode-html";

const big = "clamp(16px, 1.7vw, 28px)";
const small = "clamp(12px, 1.05vw, 17px)";

const Names = ({ names }) => <span>{names.map((n) => decodeHTML(n)).join(" & ")}</span>;

/**
 * PLAN-009 phase D: an Open Play session running now, on the venue's TV — who's
 * on each court, the next games, and how many are waiting. First names only.
 * Props: `{ session }` — one of the board's `openPlay`.
 */
const OpenPlayPanel = ({ session }) => (
  <section className="px-8 py-5 space-y-4" style={{ borderBottom: "1px solid var(--color-line)" }}>
    <div className="flex items-baseline justify-between gap-4 flex-wrap">
      <h2 className="m-0" style={{ fontSize: big, fontWeight: 700, color: "var(--color-text-dark)" }}>
        Open Play · {decodeHTML(session.title)}
        {session.paused && <span style={{ fontSize: small, fontWeight: 500, color: "var(--color-warning)" }}> · paused</span>}
      </h2>
      <span style={{ fontSize: small, color: "var(--color-text-muted)" }}>
        {session.waiting} waiting
        {session.waitingNames.length > 0 ? `: ${session.waitingNames.map((n) => decodeHTML(n)).join(", ")}` : ""}
      </span>
    </div>
    <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.min(session.courts.length, 4)}, minmax(0, 1fr))` }}>
      {session.courts.map((c) => (
        <div
          key={c.courtKey}
          className="p-4"
          style={{
            border: `2px solid ${c.game ? "var(--color-link)" : "var(--color-line)"}`,
            borderRadius: "var(--radius-card)",
            background: "var(--color-surface)",
          }}
        >
          <div style={{ fontSize: small, fontWeight: 700, letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>
            {decodeHTML(c.name).toUpperCase()}
          </div>
          {c.game ? (
            <div className="mt-2 space-y-1" style={{ fontSize: big, fontWeight: 600, color: "var(--color-text-dark)" }}>
              <div className="truncate">
                <Names names={c.game.teamA} />
              </div>
              <div style={{ fontSize: small, color: "var(--color-text-muted)" }}>vs</div>
              <div className="truncate">
                <Names names={c.game.teamB} />
              </div>
            </div>
          ) : (
            <div className="mt-2" style={{ fontSize: big, color: "var(--color-text-muted)" }}>
              Free
            </div>
          )}
        </div>
      ))}
    </div>
    {session.next.length > 0 && (
      <div className="flex items-center gap-6 flex-wrap" style={{ fontSize: small, color: "var(--color-text-secondary)" }}>
        <strong style={{ color: "var(--color-text-dark)" }}>Next up</strong>
        {session.next.map((g, i) => (
          <span key={i}>
            {i + 1}. <Names names={g.teamA} /> vs <Names names={g.teamB} />
          </span>
        ))}
      </div>
    )}
  </section>
);

export default OpenPlayPanel;
