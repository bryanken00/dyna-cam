import { Navigate } from "react-router";
import { CircleAlert, Loader2, Trophy, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";

import { useTeamInviteHooks } from "./hooks";
import PublicLayout from "../../../components/layout/PublicLayout";
import GoogleSignInButton from "../../../components/player/GoogleSignInButton";
import ResultState from "../../../components/ResultState";
import Spinner from "../../../components/Spinner";

const card = { background: "var(--color-surface)", border: "1px solid var(--color-line)", borderRadius: "var(--radius-card)" };

/** `/team-invite/:inviteToken` (PLAN-009 phase E) — join your captain's team. */
const TeamInvitePage = () => {
  const { signedIn, profileRedirect, returnPath, invite, isLoading, gone, loadError, handleJoin, isJoining, joinError } = useTeamInviteHooks();

  if (profileRedirect) return <Navigate to={profileRedirect} replace />;
  if (isLoading) {
    return (
      <PublicLayout>
        <Spinner className="py-24" tip="Loading the invite…" />
      </PublicLayout>
    );
  }
  if (gone || loadError || !invite) {
    return (
      <PublicLayout>
        <div style={card}>
          <ResultState
            status={gone ? "404" : "error"}
            title={gone ? "This invite isn't valid any more" : "Couldn't load the invite"}
            description={gone ? "The team may be full already, or registration has closed. Ask your captain." : "Check your connection and try again."}
          />
        </div>
      </PublicLayout>
    );
  }
  return (
    <PublicLayout>
      <div className="space-y-4">
        <div className="p-6 space-y-3" style={card}>
          <span className="inline-flex items-center justify-center h-12 w-12" style={{ background: "var(--color-surface-sunken)", borderRadius: 14 }}>
            <Trophy className="h-6 w-6" style={{ color: "var(--color-text-secondary)" }} />
          </span>
          <h1 className="m-0 font-semibold" style={{ fontSize: 22, color: "var(--color-text-dark)" }}>
            {invite.captain ? `${invite.captain} invited you` : "You're invited"} to team {invite.teamName}
          </h1>
          <p className="m-0" style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>
            {invite.division} · {invite.tournament} · {invite.when} · {invite.venue}
          </p>
          {signedIn ? (
            <Button size="lg" className="w-full h-12" onClick={handleJoin} disabled={isJoining}>
              {isJoining ? <Loader2 className="animate-spin" /> : <UserPlus />}
              Join the team
            </Button>
          ) : (
            <GoogleSignInButton returnPath={returnPath} />
          )}
          {joinError && (
            <p role="alert" className="m-0 flex items-start gap-2" style={{ fontSize: 13.5, color: "var(--color-error)" }}>
              <CircleAlert className="size-4 shrink-0 mt-0.5" />
              {joinError}
            </p>
          )}
        </div>
      </div>
    </PublicLayout>
  );
};

export default TeamInvitePage;
