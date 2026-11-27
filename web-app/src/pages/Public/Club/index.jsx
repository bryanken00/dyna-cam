import { Link, Navigate } from "react-router";
import { ChevronRight, CircleAlert, Loader2, UsersRound } from "lucide-react";

import { Button } from "@/components/ui/button";

import { useClubHooks } from "./hooks";
import PublicLayout from "../../../components/layout/PublicLayout";
import GoogleSignInButton from "../../../components/player/GoogleSignInButton";
import ResultState from "../../../components/ResultState";
import SectionLabel from "../../../components/SectionLabel";
import Spinner from "../../../components/Spinner";

const card = { background: "var(--color-surface)", border: "1px solid var(--color-line)", borderRadius: "var(--radius-card)" };

/** `/clubs/:clubKey` (PLAN-009 phase F) — a club's page. */
const ClubPage = () => {
  const { signedIn, profileRedirect, returnPath, club, membership, isLoading, notFound, loadError, handleJoin, handleLeave, isJoining, actionError } = useClubHooks();

  if (profileRedirect) return <Navigate to={profileRedirect} replace />;
  if (isLoading) {
    return (
      <PublicLayout>
        <Spinner className="py-24" tip="Loading the club…" />
      </PublicLayout>
    );
  }
  if (notFound || loadError || !club) {
    return (
      <PublicLayout>
        <div style={card}>
          <ResultState status={notFound ? "404" : "error"} title={notFound ? "This club isn't available" : "Couldn't load the club"} description={notFound ? "It may have been removed." : "Check your connection and try again."} />
        </div>
      </PublicLayout>
    );
  }
  return (
    <PublicLayout>
      <div className="space-y-5">
        <div className="p-5 space-y-3" style={card}>
          <span className="inline-flex items-center justify-center h-12 w-12" style={{ background: "var(--color-surface-sunken)", borderRadius: 14 }}>
            <UsersRound className="h-6 w-6" style={{ color: "var(--color-text-secondary)" }} />
          </span>
          <h1 className="m-0 font-semibold" style={{ fontSize: 24, color: "var(--color-text-dark)" }}>
            {club.name}
          </h1>
          <p className="m-0" style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}>
            {club.venue} · {club.members} member{club.members === 1 ? "" : "s"} · {club.approval ? "the club approves new members" : "anyone can join"}
          </p>
          {club.description && (
            <p className="m-0 whitespace-pre-line" style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>
              {club.description}
            </p>
          )}
          {!signedIn ? (
            <GoogleSignInButton returnPath={returnPath} />
          ) : membership === "Active" ? (
            <div className="flex items-center gap-3 flex-wrap">
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-success)" }}>You're a member</span>
              <Button variant="ghost" size="sm" onClick={handleLeave}>
                Leave
              </Button>
            </div>
          ) : membership === "Pending" ? (
            <div className="flex items-center gap-3 flex-wrap">
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-warning)" }}>Waiting for approval</span>
              <Button variant="ghost" size="sm" onClick={handleLeave}>
                Cancel request
              </Button>
            </div>
          ) : (
            <Button size="lg" className="w-full h-12" onClick={handleJoin} disabled={isJoining}>
              {isJoining && <Loader2 className="animate-spin" />}
              {club.approval ? "Ask to join" : "Join the club"}
            </Button>
          )}
          {actionError && (
            <p role="alert" className="m-0 flex items-start gap-2" style={{ fontSize: 13.5, color: "var(--color-error)" }}>
              <CircleAlert className="size-4 shrink-0 mt-0.5" />
              {actionError}
            </p>
          )}
        </div>

        <section>
          <SectionLabel>Club sessions</SectionLabel>
          {club.sessions.length === 0 ? (
            <p className="m-0" style={{ fontSize: 13.5, color: "var(--color-text-muted)" }}>
              Nothing coming up.
            </p>
          ) : (
            <ul className="m-0 p-0 list-none space-y-3">
              {club.sessions.map((s) => (
                <li key={s.key}>
                  <Link to={s.to} className="p-4 flex items-center gap-3" style={{ ...card, textDecoration: "none" }}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate" style={{ fontSize: 14.5, fontWeight: 600, color: "var(--color-text-dark)" }}>
                        {s.title}
                      </span>
                      <span className="block truncate" style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                        {s.when}
                      </span>
                      <span className="block truncate" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
                        {s.line}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--color-text-muted)" }} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <SectionLabel>Members · {club.people.length}</SectionLabel>
          <ul className="m-0 p-0 list-none flex flex-wrap gap-2">
            {club.people.map((p, i) => (
              <li key={`${p.firstName}-${i}`} className="px-3 py-1.5" style={{ fontSize: 13, border: "1px solid var(--color-line)", borderRadius: 999 }}>
                {p.firstName}
                {p.level && <span style={{ color: "var(--color-text-muted)" }}> · {p.level}</span>}
                {p.admin && <span style={{ color: "var(--color-link)" }}> · admin</span>}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </PublicLayout>
  );
};

export default ClubPage;
