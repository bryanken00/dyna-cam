import { Link } from "react-router";
import { ChevronRight, Clock, MapPin, RotateCcw, Users } from "lucide-react";

import { Button } from "@/components/ui/button";

import { useOpenPlayListHooks } from "./hooks";
import DiscoverTabs from "../../../components/layout/DiscoverTabs";
import PublicLayout from "../../../components/layout/PublicLayout";
import PickChip from "../../../components/PickChip";
import ResultState from "../../../components/ResultState";
import Spinner from "../../../components/Spinner";

const cardStyle = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-line)",
  borderRadius: "var(--radius-card)",
};
const metaStyle = { fontSize: 13, color: "var(--color-text-secondary)" };
const metaIcon = "h-3.5 w-3.5 shrink-0";

/**
 * `/open-play` (PLAN-009 phase C) — drop-in sessions: show up, get put in
 * games with players of your level. Each card opens the session's page.
 */
const COPY = {
  OpenPlay: {
    title: "Open Play",
    lead: "Join a session, show up, and the venue puts you in games with players near your level.",
    none: "No Open Play this week",
  },
  // PLAN-009 phase F: the same list, of coached clinics
  Clinic: {
    title: "Coaching",
    lead: "Clinics with a coach — drills, strategy and games for your level.",
    none: "No clinics this week",
  },
};

const OpenPlayPage = ({ kind = "OpenPlay" }) => {
  const copy = COPY[kind];
  const {
    days,
    day,
    handleDay,
    myLevel,
    myLevelOnly,
    handleMyLevel,
    sessions,
    total,
    isLoading,
    isFetching,
    loadError,
    refetch,
  } = useOpenPlayListHooks({ kind });

  return (
    <PublicLayout wide>
      <div className="space-y-4">
        <DiscoverTabs />
        <div className="pt-2 pb-1">
          <h1 className="m-0 font-semibold leading-tight" style={{ fontSize: 28, letterSpacing: "-0.5px", color: "var(--color-text-dark)" }}>
            {copy.title}
          </h1>
          <p className="m-0 mt-1.5" style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>
            {copy.lead}
          </p>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0" role="group" aria-label="Day">
          {days.map((d) => (
            <PickChip
              key={d.value}
              selected={day === d.value}
              onClick={() => handleDay(d.value)}
              className="flex flex-col items-center justify-center w-16 h-14"
              label={`${d.top} ${d.bottom}`}
            >
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{d.top}</span>
              <span style={{ fontSize: 11.5, color: "var(--color-text-muted)" }}>{d.bottom}</span>
            </PickChip>
          ))}
        </div>
        {myLevel && (
          <PickChip selected={myLevelOnly} onClick={handleMyLevel} className="px-3 h-9 text-[13.5px]">
            Fits my level ({myLevel})
          </PickChip>
        )}

        {isLoading ? (
          <Spinner className="py-16" tip="Loading sessions…" />
        ) : loadError ? (
          <div style={cardStyle}>
            <ResultState
              status="error"
              title="Couldn't load Open Play"
              description="Check your connection and try again."
              action={
                <Button onClick={() => refetch()} disabled={isFetching}>
                  <RotateCcw />
                  Try again
                </Button>
              }
            />
          </div>
        ) : sessions.length === 0 ? (
          <div style={cardStyle}>
            <ResultState
              status="404"
              icon={<Users className="w-6 h-6" strokeWidth={1.8} />}
              title={total ? "No session matches" : copy.none}
              description={total ? "Try another day or turn off the level filter." : "Check back soon, or book a court for your group."}
            />
          </div>
        ) : (
          <ul className="p-0 list-none grid gap-3 lg:grid-cols-2">
            {sessions.map((s) => (
              <li key={s.key} className="min-w-0">
                <Link to={s.to} className="h-full p-4 flex items-center gap-3.5" style={{ ...cardStyle, textDecoration: "none" }}>
                  <span
                    className="inline-flex flex-col items-center justify-center h-14 w-14 shrink-0"
                    style={{ background: "var(--color-surface-sunken)", border: "1px solid var(--color-line)", borderRadius: 14 }}
                  >
                    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-muted)" }}>{s.weekday}</span>
                    <span style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-dark)" }}>{s.dateNumber}</span>
                  </span>
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="block truncate" style={{ fontSize: 15.5, fontWeight: 600, color: "var(--color-text-dark)" }}>
                      {s.title}
                    </span>
                    <span className="flex items-center gap-1.5" style={metaStyle}>
                      <Clock className={metaIcon} />
                      {s.live ? <strong style={{ color: "var(--color-success)" }}>On now · </strong> : null}
                      {s.time}
                    </span>
                    <span className="flex items-center gap-1.5" style={metaStyle}>
                      <MapPin className={metaIcon} />
                      <span className="truncate">{s.venue}</span>
                    </span>
                    {(s.coach || s.club) && (
                      <span className="block truncate" style={{ ...metaStyle, color: "var(--color-text-muted)" }}>
                        {[s.coach && `Coach ${s.coach}`, s.club && `${s.club} members only`].filter(Boolean).join(" · ")}
                      </span>
                    )}
                    <span className="flex items-center gap-x-3 gap-y-1 flex-wrap" style={{ ...metaStyle, color: "var(--color-text-muted)" }}>
                      <span>{s.level}</span>
                      <span>{s.fee}</span>
                      <span style={{ fontWeight: 600, color: s.full ? "var(--color-error)" : "var(--color-text-secondary)" }}>
                        {s.spots}
                      </span>
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--color-text-muted)" }} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PublicLayout>
  );
};

export default OpenPlayPage;
