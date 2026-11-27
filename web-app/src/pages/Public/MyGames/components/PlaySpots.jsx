import { Link } from "react-router";
import { ChevronRight, Users } from "lucide-react";

import SectionLabel from "../../../../components/SectionLabel";

/**
 * PLAN-009 phase C: the player's Open Play spots still to come, on the Play tab.
 * Each opens its session's page (pay a held spot, or cancel there).
 */
const PlaySpots = ({ spots }) =>
  spots.length > 0 && (
    <section>
      <SectionLabel>Open Play</SectionLabel>
      <ul className="m-0 p-0 list-none space-y-3">
        {spots.map((s) => (
          <li key={s.key}>
            <Link
              to={s.to}
              className="p-4 flex items-center gap-3"
              style={{
                background: "var(--color-surface)",
                border: `1px solid ${s.pending ? "var(--color-warning)" : "var(--color-line)"}`,
                borderRadius: "var(--radius-card)",
                textDecoration: "none",
              }}
            >
              <span
                className="inline-flex items-center justify-center h-10 w-10 shrink-0"
                style={{ background: "var(--color-surface-sunken)", borderRadius: 12 }}
              >
                <Users className="h-5 w-5" style={{ color: "var(--color-text-secondary)" }} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate" style={{ fontSize: 14.5, fontWeight: 600, color: "var(--color-text-dark)" }}>
                  {s.title}
                </span>
                <span className="block truncate" style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                  {s.live ? "On now · " : ""}
                  {s.when}
                </span>
                <span className="block truncate" style={{ fontSize: 12.5, color: s.pending ? "var(--color-warning)" : "var(--color-text-muted)" }}>
                  {s.pending ? "Not paid yet — open to pay" : s.where}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--color-text-muted)" }} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );

export default PlaySpots;
