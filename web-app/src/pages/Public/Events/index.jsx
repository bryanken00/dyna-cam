import { Link } from "react-router";
import { CalendarDays, ChevronRight, MapPin, RotateCcw, Trophy } from "lucide-react";

import { Button } from "@/components/ui/button";

import { useEventsHooks } from "./hooks";
import DiscoverTabs from "../../../components/layout/DiscoverTabs";
import PublicLayout from "../../../components/layout/PublicLayout";
import ResultState from "../../../components/ResultState";
import Spinner from "../../../components/Spinner";

const card = { background: "var(--color-surface)", border: "1px solid var(--color-line)", borderRadius: "var(--radius-card)" };
const meta = { fontSize: 13, color: "var(--color-text-secondary)" };

/** `/events` (PLAN-009 phase E) — tournaments to register for or follow. */
const EventsPage = () => {
  const { events, isLoading, isFetching, loadError, refetch } = useEventsHooks();
  return (
    <PublicLayout wide>
      <div className="space-y-4">
        <DiscoverTabs />
        <div className="pt-2 pb-1">
          <h1 className="m-0 font-semibold leading-tight" style={{ fontSize: 28, letterSpacing: "-0.5px", color: "var(--color-text-dark)" }}>
            Tournaments
          </h1>
          <p className="m-0 mt-1.5" style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>
            Register a team, follow the draw and live results.
          </p>
        </div>
        {isLoading ? (
          <Spinner className="py-16" tip="Loading tournaments…" />
        ) : loadError ? (
          <div style={card}>
            <ResultState
              status="error"
              title="Couldn't load tournaments"
              description="Check your connection and try again."
              action={
                <Button onClick={() => refetch()} disabled={isFetching}>
                  <RotateCcw />
                  Try again
                </Button>
              }
            />
          </div>
        ) : events.length === 0 ? (
          <div style={card}>
            <ResultState status="404" icon={<Trophy className="w-6 h-6" strokeWidth={1.8} />} title="No tournaments coming up" description="Check back soon." />
          </div>
        ) : (
          <ul className="p-0 list-none grid gap-3 lg:grid-cols-2">
            {events.map((e) => (
              <li key={e.key}>
                <Link to={e.to} className="h-full p-4 flex items-start gap-3.5" style={{ ...card, textDecoration: "none" }}>
                  <span className="inline-flex items-center justify-center h-12 w-12 shrink-0" style={{ background: "var(--color-surface-sunken)", borderRadius: 14 }}>
                    <Trophy className="h-6 w-6" style={{ color: "var(--color-text-secondary)" }} />
                  </span>
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="block truncate" style={{ fontSize: 15.5, fontWeight: 600, color: "var(--color-text-dark)" }}>
                      {e.name}
                    </span>
                    <span className="flex items-center gap-1.5" style={meta}>
                      <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                      {e.when}
                      {e.live ? <strong style={{ color: "var(--color-success)" }}> · on now</strong> : e.open ? <strong style={{ color: "var(--color-link)" }}> · registration open</strong> : null}
                    </span>
                    <span className="flex items-center gap-1.5" style={meta}>
                      <MapPin className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{e.venue}</span>
                    </span>
                    {e.divisions.map((d) => (
                      <span key={d.name} className="block truncate" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
                        <span style={{ color: "var(--color-text-secondary)", fontWeight: 500 }}>{d.name}</span> · {d.line}
                      </span>
                    ))}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 mt-1" style={{ color: "var(--color-text-muted)" }} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PublicLayout>
  );
};

export default EventsPage;
