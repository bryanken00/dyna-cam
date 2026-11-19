import { Film } from "lucide-react";

import SectionLabel from "../../../../components/SectionLabel";
import StatusDot from "../../../../components/StatusDot";
import CourtDiagram from "./CourtDiagram";

const PANEL = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-line)",
  borderRadius: "var(--radius-card)",
};

/** One court: name, the court drawn with its cameras, what's happening on it. */
const CourtCard = ({ court }) => (
  <div className="flex flex-col theme-transition" style={{ ...PANEL, padding: "14px 16px" }}>
    <div className="flex items-center justify-between gap-3">
      <span
        className="truncate"
        style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-dark)" }}
      >
        {court.name}
      </span>
      <span
        className="inline-flex items-center gap-1 shrink-0"
        style={{ fontSize: 12, color: "var(--color-text-muted)" }}
        title="Replays saved on this court today"
      >
        <Film className="w-3.5 h-3.5" strokeWidth={1.8} />
        {court.replaysToday}
      </span>
    </div>

    <div className="my-3">
      <CourtDiagram state={court.state} cameras={court.cameras} label={court.statusText} />
    </div>

    <StatusDot tone={court.tone}>
      <span style={{ color: "var(--color-text-dark)", fontWeight: 500 }}>{court.statusText}</span>
    </StatusDot>
    <p className="m-0 mt-1 truncate" style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
      {court.cameraText}
    </p>
  </div>
);

/**
 * Every court, venue by venue (CR-008). Empty → a short pointer to Setup.
 */
const CourtBoard = ({ venues }) => {
  if (venues.length === 0) {
    return (
      <div className="px-4.5 py-12 text-center" style={PANEL}>
        <p className="m-0" style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}>
          No courts yet
        </p>
        <p className="m-0 mt-1" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
          Add a venue and its courts in Setup, and they'll show up here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {venues.map((venue) => (
        <section key={venue.venueId}>
          <div className="flex items-baseline justify-between gap-3">
            <SectionLabel>{venue.venueName}</SectionLabel>
            <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
              {venue.summary}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3.5">
            {venue.courts.map((court) => (
              <CourtCard key={court.courtId} court={court} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
};

export default CourtBoard;
