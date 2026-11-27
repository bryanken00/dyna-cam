import { Link } from "react-router";
import { ChevronRight, Trophy } from "lucide-react";

import SectionLabel from "../../../../components/SectionLabel";

/**
 * PLAN-009 phase E: the player's tournament teams on the Play tab — entry state
 * and the next match (or the last result). Each opens the tournament's page.
 */
const MyTournaments = ({ teams }) =>
  teams.length > 0 && (
    <section>
      <SectionLabel>Tournaments</SectionLabel>
      <ul className="m-0 p-0 list-none space-y-3">
        {teams.map((t) => (
          <li key={t.key}>
            <Link
              to={t.to}
              className="p-4 flex items-center gap-3"
              style={{
                background: "var(--color-surface)",
                border: `1px solid ${t.needsAction ? "var(--color-warning)" : "var(--color-line)"}`,
                borderRadius: "var(--radius-card)",
                textDecoration: "none",
              }}
            >
              <span className="inline-flex items-center justify-center h-10 w-10 shrink-0" style={{ background: "var(--color-surface-sunken)", borderRadius: 12 }}>
                <Trophy className="h-5 w-5" style={{ color: "var(--color-text-secondary)" }} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate" style={{ fontSize: 14.5, fontWeight: 600, color: "var(--color-text-dark)" }}>
                  {t.tournament}
                </span>
                <span className="block truncate" style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                  {t.team} · {t.division}
                </span>
                <span className="block truncate" style={{ fontSize: 12.5, color: t.needsAction ? "var(--color-warning)" : "var(--color-text-muted)" }}>
                  {t.line}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--color-text-muted)" }} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );

export default MyTournaments;
