import { Link } from "react-router";
import { ChevronRight } from "lucide-react";

import SectionLabel from "../../../../components/SectionLabel";

const tileStyle = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-line)",
  borderRadius: "var(--radius-card)",
  textDecoration: "none",
};

/** One venue tile: its logo (or first letter) and name; opens its booking page when it takes bookings. */
const VenueTile = ({ venue }) => {
  const body = (
    <>
      <span
        className="inline-flex items-center justify-center h-10 w-10 shrink-0 overflow-hidden"
        style={{ background: "var(--color-surface-sunken)", border: "1px solid var(--color-line)", borderRadius: 12 }}
      >
        {venue.logo ? (
          <img src={venue.logo} alt="" className="h-full w-full object-contain p-1" />
        ) : (
          <span style={{ fontSize: 16, fontWeight: 600, color: "var(--color-text-secondary)" }}>
            {venue.name.charAt(0).toUpperCase()}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate" style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-dark)" }}>
          {venue.name}
        </span>
        <span className="block truncate" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
          {venue.to ? "Book a court" : "Not taking online bookings now"}
        </span>
      </span>
      {venue.to && <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--color-text-muted)" }} />}
    </>
  );
  const className = "p-3 flex items-center gap-3 w-64 shrink-0 sm:w-auto";
  return venue.to ? (
    <Link to={venue.to} className={className} style={tileStyle}>
      {body}
    </Link>
  ) : (
    <div className={className} style={{ ...tileStyle, opacity: 0.7 }}>
      {body}
    </div>
  );
};

/** A row of venue tiles — scrolls sideways on phones, a grid from tablets up. */
const VenueRow = ({ title, venues }) =>
  venues.length > 0 && (
    <section>
      <SectionLabel>{title}</SectionLabel>
      <div className="flex gap-3 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0 sm:grid sm:grid-cols-2 sm:overflow-visible">
        {venues.map((v) => (
          <VenueTile key={v.key} venue={v} />
        ))}
      </div>
    </section>
  );

/**
 * PLAN-009 phase B: the top of the Play tab — venues booked lately (Book again)
 * and the venues the player follows. Nothing shows until there's something.
 */
const VenueShortcuts = ({ recent, following }) => (
  <>
    <VenueRow title="Book again" venues={recent} />
    <VenueRow title="Following" venues={following} />
  </>
);

export default VenueShortcuts;
