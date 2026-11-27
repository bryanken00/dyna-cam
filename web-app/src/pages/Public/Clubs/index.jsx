import { Link } from "react-router";
import { ChevronRight, RotateCcw, UsersRound } from "lucide-react";

import { Button } from "@/components/ui/button";

import { useClubsHooks } from "./hooks";
import PublicLayout from "../../../components/layout/PublicLayout";
import ResultState from "../../../components/ResultState";
import SearchInput from "../../../components/SearchInput";
import SectionLabel from "../../../components/SectionLabel";
import Spinner from "../../../components/Spinner";

const card = { background: "var(--color-surface)", border: "1px solid var(--color-line)", borderRadius: "var(--radius-card)", textDecoration: "none" };

const ClubRow = ({ c }) => (
  <li>
    <Link to={c.to} className="p-4 flex items-center gap-3" style={card}>
      <span className="inline-flex items-center justify-center h-11 w-11 shrink-0" style={{ background: "var(--color-surface-sunken)", borderRadius: 12 }}>
        <UsersRound className="h-5 w-5" style={{ color: "var(--color-text-secondary)" }} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate" style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-dark)" }}>
          {c.name}
        </span>
        <span className="block truncate" style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
          {c.venue} · {c.members} member{c.members === 1 ? "" : "s"}
          {c.status === "Pending" ? " · waiting for approval" : c.approval && !c.status ? " · approval to join" : ""}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--color-text-muted)" }} />
    </Link>
  </li>
);

/** `/clubs` (PLAN-009 phase F) — the Clubs tab: my clubs, and clubs to join. */
const ClubsPage = () => {
  const { mine, all, search, handleSearch, isLoading, isFetching, loadError, refetch } = useClubsHooks();
  return (
    <PublicLayout>
      <div className="space-y-5">
        <div className="pt-2">
          <h1 className="m-0 font-semibold leading-tight" style={{ fontSize: 28, letterSpacing: "-0.5px", color: "var(--color-text-dark)" }}>
            Clubs
          </h1>
          <p className="m-0 mt-1.5" style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>
            Play with the same crowd — members-only sessions and events.
          </p>
        </div>
        {mine.length > 0 && (
          <section>
            <SectionLabel>My clubs</SectionLabel>
            <ul className="m-0 p-0 list-none space-y-3">
              {mine.map((c) => (
                <ClubRow key={c.key} c={c} />
              ))}
            </ul>
          </section>
        )}
        <section className="space-y-3">
          <SectionLabel>Find a club</SectionLabel>
          <SearchInput value={search} onChange={handleSearch} placeholder="Search by club or venue" width="100%" />
          {isLoading ? (
            <Spinner className="py-12" />
          ) : loadError ? (
            <div style={card}>
              <ResultState
                status="error"
                title="Couldn't load clubs"
                description="Check your connection and try again."
                action={
                  <Button onClick={() => refetch()} disabled={isFetching}>
                    <RotateCcw />
                    Try again
                  </Button>
                }
              />
            </div>
          ) : all.length === 0 ? (
            <p className="m-0" style={{ fontSize: 13.5, color: "var(--color-text-muted)" }}>
              {search ? "No club matches." : "No other clubs yet."}
            </p>
          ) : (
            <ul className="m-0 p-0 list-none space-y-3">
              {all.map((c) => (
                <ClubRow key={c.key} c={c} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </PublicLayout>
  );
};

export default ClubsPage;
