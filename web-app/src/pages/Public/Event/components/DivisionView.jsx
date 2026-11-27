import dayjs from "dayjs";

import SectionLabel from "../../../../components/SectionLabel";
import { decodeHTML } from "../../../../utils/decode-html";
import { roundName } from "../../../../utils/tournaments";

const card = { background: "var(--color-surface)", border: "1px solid var(--color-line)", borderRadius: "var(--radius-card)" };

/** "Smashers 11–7 Dinkers" with the winner bold, court and time underneath. */
const MatchLine = ({ m }) => (
  <li className="py-2" style={{ borderTop: "1px solid var(--color-line)" }}>
    <div style={{ fontSize: 14, color: "var(--color-text-dark)" }}>
      <span style={{ fontWeight: m.winner && m.winner === m.teamA ? 700 : 400 }}>{decodeHTML(m.teamAName || "To be decided")}</span>
      {m.status === "Bye" ? (
        <span style={{ color: "var(--color-text-muted)" }}> · bye</span>
      ) : (
        <>
          <span className="font-mono" style={{ color: "var(--color-text-secondary)" }}>
            {m.status === "Done" ? ` ${m.scoreA}–${m.scoreB} ` : " vs "}
          </span>
          <span style={{ fontWeight: m.winner && m.winner === m.teamB ? 700 : 400 }}>{decodeHTML(m.teamBName || "To be decided")}</span>
        </>
      )}
    </div>
    {(m.status === "Playing" || (m.court && m.scheduledAt && m.status !== "Done")) && (
      <div style={{ fontSize: 12.5, color: m.status === "Playing" ? "var(--color-success)" : "var(--color-text-muted)" }}>
        {m.status === "Playing" ? `On ${decodeHTML(m.court)} now` : `${decodeHTML(m.court)} · ${dayjs(m.scheduledAt).format("ddd h:mm A")}`}
      </div>
    )}
  </li>
);

/**
 * PLAN-009 phase E: one division's draw on the player app — group tables, group
 * matches and the knockout by round. Before the draw: the teams entered so far.
 */
const DivisionView = ({ division: d }) => {
  const groupMatches = d.matches.filter((m) => m.stage === "Group");
  const knockout = d.matches.filter((m) => m.stage === "Knockout");
  const rounds = Math.max(0, ...knockout.map((m) => m.round));

  if (!d.drawOut) {
    const teams = d.teams.filter((t) => t.registered);
    return (
      <div className="p-4" style={card}>
        <SectionLabel>Teams in · {teams.length}</SectionLabel>
        {teams.length === 0 ? (
          <p className="m-0" style={{ fontSize: 13.5, color: "var(--color-text-muted)" }}>
            No teams yet.
          </p>
        ) : (
          <ul className="m-0 p-0 list-none space-y-1">
            {teams.map((t) => (
              <li key={t.key} style={{ fontSize: 14, color: "var(--color-text-dark)" }}>
                {decodeHTML(t.name)}
                <span style={{ color: "var(--color-text-muted)" }}> · {t.players.map((p) => p.firstName).join(" & ")}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {d.tables.map((g) => (
        <div key={g.groupNo} className="p-4" style={card}>
          <SectionLabel>Group {g.groupNo}</SectionLabel>
          <table className="w-full" style={{ fontSize: 13.5, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "var(--color-text-muted)", fontSize: 12 }}>
                <th className="text-left font-medium py-1">Team</th>
                <th className="font-medium">W</th>
                <th className="font-medium">L</th>
                <th className="font-medium">+/−</th>
              </tr>
            </thead>
            <tbody>
              {g.rows.map((r) => (
                <tr key={r.teamId} style={{ borderTop: "1px solid var(--color-line)" }}>
                  <td className="py-1.5">{decodeHTML(r.teamName)}</td>
                  <td className="text-center">{r.wins}</td>
                  <td className="text-center">{r.losses}</td>
                  <td className="text-center font-mono">{r.diff > 0 ? `+${r.diff}` : r.diff}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="m-0 mt-3 p-0 list-none">
            {groupMatches
              .filter((m) => m.groupNo === g.groupNo)
              .map((m) => (
                <MatchLine key={`${m.round}-${m.slot}`} m={m} />
              ))}
          </ul>
        </div>
      ))}
      {Array.from({ length: rounds }, (_, i) => i + 1).map((round) => (
        <div key={round} className="p-4" style={card}>
          <SectionLabel>{roundName(round, rounds)}</SectionLabel>
          <ul className="m-0 p-0 list-none">
            {knockout
              .filter((m) => m.round === round)
              .map((m) => (
                <MatchLine key={m.slot} m={m} />
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
};

export default DivisionView;
