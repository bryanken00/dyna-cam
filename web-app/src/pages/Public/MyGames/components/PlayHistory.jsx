import { Link } from "react-router";

import SectionLabel from "../../../../components/SectionLabel";

const card = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-line)",
  borderRadius: "var(--radius-card)",
};

/** One game: "W 11–7 with Ana vs Ben & Cy". */
const GameLine = ({ game }) => {
  const result = game.won === null ? "" : game.won ? "W" : "L";
  const score = game.scoreFor === null ? "" : `${game.scoreFor}–${game.scoreAgainst}`;
  return (
    <li style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
      {result && (
        <strong style={{ color: game.won ? "var(--color-success)" : "var(--color-text-muted)" }}>{result} </strong>
      )}
      {score && <span style={{ color: "var(--color-text-dark)" }}>{score} </span>}
      with {game.partners.join(" & ") || "—"} vs {game.opponents.join(" & ")}
    </li>
  );
};

/**
 * PLAN-009 phase D: Open Play sessions the player went to, with each game's
 * partner, opponents and score (when staff entered one). Props: `{ sessions }`.
 */
const PlayHistory = ({ sessions }) =>
  sessions.length > 0 && (
    <section>
      <SectionLabel>Open Play history</SectionLabel>
      <ul className="m-0 p-0 list-none space-y-3">
        {sessions.map((s) => (
          <li key={s.key} className="p-4 space-y-2" style={card}>
            <Link to={s.to} className="block" style={{ textDecoration: "none" }}>
              <span className="block truncate" style={{ fontSize: 14.5, fontWeight: 600, color: "var(--color-text-dark)" }}>
                {s.title}
              </span>
              <span className="block truncate" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
                {s.when} · {s.where}
                {s.record ? ` · ${s.record}` : ""}
              </span>
            </Link>
            {s.games.length > 0 ? (
              <ol className="m-0 pl-4 space-y-0.5">
                {s.games.map((g, i) => (
                  <GameLine key={i} game={g} />
                ))}
              </ol>
            ) : (
              <p className="m-0" style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
                {s.status === "Cancelled" ? "Cancelled" : s.status === "Expired" ? "Not paid in time" : "No games recorded"}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );

export default PlayHistory;
