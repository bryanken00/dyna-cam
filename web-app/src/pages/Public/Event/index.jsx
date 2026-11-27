import { Navigate } from "react-router";
import { CalendarDays, CircleAlert, CreditCard, Link2, Loader2, MapPin, Navigation, RotateCcw, Trophy, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { useEventHooks } from "./hooks";
import DivisionView from "./components/DivisionView";
import PublicLayout from "../../../components/layout/PublicLayout";
import GoogleSignInButton from "../../../components/player/GoogleSignInButton";
import ResultState from "../../../components/ResultState";
import Spinner from "../../../components/Spinner";
import { decodeHTML } from "../../../utils/decode-html";
import { formatPeso } from "../../../utils/dynaCam";
import { levelRange } from "../../../utils/openPlay";
import { FORMAT_TEXT } from "../../../utils/tournaments";

const card = { background: "var(--color-surface)", border: "1px solid var(--color-line)", borderRadius: "var(--radius-card)" };
const row = { fontSize: 14, color: "var(--color-text-secondary)" };
const icon = "h-4 w-4 shrink-0 mt-0.5";

/** The player's own entry: paid or not, the partner invite, withdraw. */
const MyEntry = ({ team, onPay, onCopyInvite, onWithdraw, isPaying }) => {
  const unpaid = team.captain && team.paymentStatus === "Unpaid";
  return (
    <div className="p-4 space-y-3" style={{ ...card, borderColor: team.status === "Registered" ? "var(--color-success)" : "var(--color-warning)" }}>
      <div>
        <div style={{ fontSize: 15.5, fontWeight: 600, color: "var(--color-text-dark)" }}>
          {team.status === "Registered" ? `You're in: ${decodeHTML(team.name)}` : `Team ${decodeHTML(team.name)} — not in yet`}
        </div>
        <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
          {decodeHTML(team.divisionName)} ·{" "}
          {team.status === "Registered"
            ? team.drawOut
              ? "the draw is out"
              : "we'll email you when the draw is out"
            : unpaid
              ? "pay the entry fee to keep your place"
              : team.inviteUrl
                ? "waiting for your partner to join"
                : "waiting for your captain to pay"}
        </div>
      </div>
      <div className="flex gap-2 flex-wrap">
        {unpaid && (
          <Button onClick={() => onPay(team)} disabled={isPaying}>
            {isPaying ? <Loader2 className="animate-spin" /> : <CreditCard />}
            Pay {formatPeso(team.price)}
          </Button>
        )}
        {team.inviteUrl && (
          <Button variant="outline" onClick={() => onCopyInvite(team)}>
            <Link2 />
            Copy partner invite
          </Button>
        )}
        {team.canWithdraw && (
          <Button variant="ghost" onClick={() => onWithdraw(team)}>
            Withdraw
          </Button>
        )}
      </div>
    </div>
  );
};

/**
 * `/events/:tournamentKey` (PLAN-009 phase E) — a tournament's page: when and
 * where, its divisions (register a team), your entry, and each division's draw.
 */
const EventPage = () => {
  const {
    signedIn,
    profileRedirect,
    returnPath,
    tournament,
    divisions,
    myTeams,
    inDivision,
    teamName,
    handleTeamName,
    handleRegister,
    handlePay,
    handleCopyInvite,
    handleWithdraw,
    isRegistering,
    isPaying,
    actionError,
    isLoading,
    isFetching,
    notFound,
    loadError,
    refetch,
  } = useEventHooks();

  if (profileRedirect) return <Navigate to={profileRedirect} replace />;
  if (isLoading) {
    return (
      <PublicLayout>
        <Spinner className="py-24" tip="Loading the tournament…" />
      </PublicLayout>
    );
  }
  if (notFound || loadError || !tournament) {
    return (
      <PublicLayout>
        <div style={card}>
          <ResultState
            status={notFound ? "404" : "error"}
            title={notFound ? "This tournament isn't available" : "Couldn't load the tournament"}
            description={notFound ? "It may have been removed." : "Check your connection and try again."}
            action={
              !notFound && (
                <Button onClick={() => refetch()} disabled={isFetching}>
                  <RotateCcw />
                  Try again
                </Button>
              )
            }
          />
        </div>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout wide>
      <div className="space-y-5 max-w-3xl">
        <div className="pt-2">
          <p className="m-0" style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: "0.04em", color: "var(--color-text-muted)" }}>
            TOURNAMENT{tournament.status === "Live" ? " · ON NOW" : tournament.status === "Finished" ? " · FINISHED" : tournament.status === "Cancelled" ? " · CANCELLED" : ""}
          </p>
          <h1 className="m-0 mt-1 font-semibold leading-tight" style={{ fontSize: 26, letterSpacing: "-0.5px", color: "var(--color-text-dark)" }}>
            {tournament.name}
          </h1>
        </div>

        <div className="p-4 space-y-2.5" style={card}>
          <div className="flex items-start gap-2.5" style={row}>
            <CalendarDays className={icon} />
            <span>{tournament.when}</span>
          </div>
          <div className="flex items-start gap-2.5" style={row}>
            <MapPin className={icon} />
            <span>
              {tournament.venue} · {tournament.courts}
              {tournament.address && (
                <>
                  <br />
                  <span style={{ color: "var(--color-text-muted)" }}>{tournament.address}</span>
                </>
              )}
            </span>
          </div>
          <div className="flex items-start gap-2.5" style={row}>
            <Users className={icon} />
            <span>{tournament.registrationOpen ? `Registration open until ${tournament.closes}` : "Registration is closed"}</span>
          </div>
          {tournament.description && (
            <p className="m-0 pt-1 whitespace-pre-line" style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}>
              {tournament.description}
            </p>
          )}
          {tournament.directionsUrl && (
            <Button asChild size="sm" variant="outline">
              <a href={tournament.directionsUrl} target="_blank" rel="noopener noreferrer">
                <Navigation />
                Directions
              </a>
            </Button>
          )}
        </div>

        {myTeams.map((t) => (
          <MyEntry key={t.teamCode} team={t} onPay={handlePay} onCopyInvite={handleCopyInvite} onWithdraw={handleWithdraw} isPaying={isPaying} />
        ))}

        {actionError && (
          <p role="alert" className="m-0 flex items-start gap-2" style={{ fontSize: 13.5, color: "var(--color-error)" }}>
            <CircleAlert className="size-4 shrink-0 mt-0.5" />
            {actionError}
          </p>
        )}

        {tournament.registrationOpen && !signedIn && (
          <div className="p-5" style={card}>
            <ResultState
              status="404"
              icon={<Trophy className="w-6 h-6" strokeWidth={1.8} />}
              title="Sign in to register a team"
              description="Use your Google account — your entry and the tournament's emails go to it."
              action={<GoogleSignInButton returnPath={returnPath} />}
            />
          </div>
        )}

        {divisions.map((d) => (
          <section key={d.key} className="space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <h2 className="m-0 font-semibold" style={{ fontSize: 18, color: "var(--color-text-dark)" }}>
                  {decodeHTML(d.name)}
                </h2>
                <p className="m-0" style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                  {FORMAT_TEXT[d.format]} · {d.teamSize === 2 ? "doubles" : "singles"} · {levelRange(d.minLevel, d.maxLevel)} ·{" "}
                  {d.entryFee > 0 ? `${formatPeso(d.entryFee)} per team` : "free"} · {d.spotsLeft > 0 ? `${d.spotsLeft} places left` : "full"}
                </p>
              </div>
            </div>
            {tournament.registrationOpen && signedIn && !d.drawOut && d.spotsLeft > 0 && !inDivision(d) && (
              <div className="flex gap-2 flex-wrap">
                <Input
                  className="h-11 w-56"
                  placeholder="Team name (optional)"
                  value={teamName}
                  onChange={(e) => handleTeamName(e.target.value)}
                  maxLength={60}
                  aria-label="Team name"
                />
                <Button size="lg" className="h-11" onClick={() => handleRegister(d)} disabled={isRegistering}>
                  {isRegistering ? <Loader2 className="animate-spin" /> : <Trophy />}
                  {d.entryFee > 0 ? `Register · ${formatPeso(d.entryFee)}` : "Register — free"}
                </Button>
              </div>
            )}
            <DivisionView division={d} />
          </section>
        ))}
      </div>
    </PublicLayout>
  );
};

export default EventPage;
