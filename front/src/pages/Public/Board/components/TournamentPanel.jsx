import dayjs from "dayjs";

import { decodeHTML } from "../../../../utils/decode-html";

const big = "clamp(16px, 1.6vw, 26px)";
const small = "clamp(12px, 1.05vw, 17px)";

/** "Smashers 11 – 7 Dinkers" — the winner in bold. */
const Line = ({ m, court }) => (
  <div className="truncate" style={{ fontSize: big, color: "var(--color-text-dark)" }}>
    {court && <span style={{ fontSize: small, fontWeight: 700, color: "var(--color-text-muted)" }}>{court.toUpperCase()} · </span>}
    <span style={{ fontWeight: m.winner === "A" ? 700 : 500 }}>{decodeHTML(m.teamA || "TBD")}</span>
    {m.scoreA !== null && m.scoreA !== undefined ? ` ${m.scoreA} – ${m.scoreB} ` : " vs "}
    <span style={{ fontWeight: m.winner === "B" ? 700 : 500 }}>{decodeHTML(m.teamB || "TBD")}</span>
    <span style={{ fontSize: small, color: "var(--color-text-muted)" }}> · {decodeHTML(m.division)}</span>
  </div>
);

/**
 * PLAN-009 phase E: a tournament running today, on the venue's TV — matches on
 * court, the next ones with their court and time, and the latest results.
 * Props: `{ tournament, courtName }` (courtName: courtKey → the court's name).
 */
const TournamentPanel = ({ tournament, courtName }) => (
  <section className="px-8 py-5 space-y-3" style={{ borderBottom: "1px solid var(--color-line)" }}>
    <h2 className="m-0" style={{ fontSize: big, fontWeight: 700, color: "var(--color-text-dark)" }}>
      {decodeHTML(tournament.name)}
    </h2>
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-1">
        <div style={{ fontSize: small, fontWeight: 700, color: "var(--color-link)" }}>ON COURT</div>
        {tournament.playing.length ? (
          tournament.playing.map((m, i) => <Line key={i} m={m} court={courtName(m.courtKey)} />)
        ) : (
          <div style={{ fontSize: small, color: "var(--color-text-muted)" }}>—</div>
        )}
      </div>
      <div className="space-y-1">
        <div style={{ fontSize: small, fontWeight: 700, color: "var(--color-text-muted)" }}>UP NEXT</div>
        {tournament.next.length ? (
          tournament.next.map((m, i) => (
            <div key={i}>
              <Line m={m} court={courtName(m.courtKey)} />
              <div style={{ fontSize: small, color: "var(--color-text-muted)" }}>{dayjs(m.scheduledAt).format("h:mm A")}</div>
            </div>
          ))
        ) : (
          <div style={{ fontSize: small, color: "var(--color-text-muted)" }}>—</div>
        )}
      </div>
      <div className="space-y-1">
        <div style={{ fontSize: small, fontWeight: 700, color: "var(--color-text-muted)" }}>RESULTS</div>
        {tournament.results.length ? (
          tournament.results.map((m, i) => <Line key={i} m={m} />)
        ) : (
          <div style={{ fontSize: small, color: "var(--color-text-muted)" }}>—</div>
        )}
      </div>
    </div>
  </section>
);

export default TournamentPanel;
