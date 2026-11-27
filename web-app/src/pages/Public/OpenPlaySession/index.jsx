import { Link, Navigate } from "react-router";
import {
  CalendarDays,
  CircleAlert,
  CreditCard,
  LayoutGrid,
  Loader2,
  MapPin,
  Navigation,
  RotateCcw,
  Share2,
  Signal,
  GraduationCap,
  Users,
  UsersRound,
} from "lucide-react";

import { Button } from "@/components/ui/button";

import { useOpenPlaySessionHooks } from "./hooks";
import PublicLayout from "../../../components/layout/PublicLayout";
import GoogleSignInButton from "../../../components/player/GoogleSignInButton";
import ResultState from "../../../components/ResultState";
import SectionLabel from "../../../components/SectionLabel";
import MyQueue from "./components/MyQueue";
import Spinner from "../../../components/Spinner";

const cardStyle = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-line)",
  borderRadius: "var(--radius-card)",
};
const rowStyle = { fontSize: 14, color: "var(--color-text-secondary)" };
const rowIcon = "h-4 w-4 shrink-0 mt-0.5";

/** "You're in" / "Pay to keep your spot" — the player's spot, with its actions. */
const MySpot = ({ mine, cancelBy, onPay, onCancel, isPaying, isCancelling }) => {
  const pending = mine.status === "Pending";
  return (
    <div className="p-4 space-y-3" style={{ ...cardStyle, borderColor: pending ? "var(--color-warning)" : "var(--color-success)" }}>
      <div>
        <div style={{ fontSize: 15.5, fontWeight: 600, color: "var(--color-text-dark)" }}>
          {pending ? "Pay to keep your spot" : mine.status === "CheckedIn" ? "You're checked in" : "You're in"}
        </div>
        <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
          {pending
            ? "Your spot is held for a few minutes while you pay."
            : mine.paymentStatus === "Paid"
              ? cancelBy
                ? `Paid. Can't make it? Cancel by ${cancelBy} for a refund.`
                : "Paid."
              : "Free. Can't make it? Give your spot up so someone else can play."}
        </div>
      </div>
      <div className="flex gap-2 flex-wrap">
        {pending && (
          <Button size="lg" className="h-12 flex-1" onClick={onPay} disabled={isPaying}>
            {isPaying ? <Loader2 className="animate-spin" /> : <CreditCard />}
            Pay now
          </Button>
        )}
        {mine.status !== "CheckedIn" && (
          <Button size="lg" variant="outline" className="h-12" onClick={onCancel} disabled={isCancelling}>
            {isCancelling ? <Loader2 className="animate-spin" /> : null}
            {pending ? "Cancel" : "Give up my spot"}
          </Button>
        )}
      </div>
    </div>
  );
};

/**
 * `/open-play/:playToken` (PLAN-009 phase C) — an Open Play session's page:
 * details, who's going (first names and levels), and join / pay / cancel.
 */
const OpenPlaySessionPage = () => {
  const {
    signedIn,
    profileRedirect,
    returnPath,
    session,
    open,
    mine,
    queue,
    cancelBy,
    isLoading,
    isFetching,
    notFound,
    loadError,
    refetch,
    actionError,
    handleJoin,
    handlePay,
    handleCancel,
    handleShare,
    isJoining,
    isPaying,
    isCancelling,
  } = useOpenPlaySessionHooks();

  if (profileRedirect) return <Navigate to={profileRedirect} replace />;
  if (isLoading) {
    return (
      <PublicLayout>
        <Spinner className="py-24" tip="Loading the session…" />
      </PublicLayout>
    );
  }
  if (notFound || loadError || !session) {
    return (
      <PublicLayout>
        <div style={cardStyle}>
          <ResultState
            status={notFound ? "404" : "error"}
            title={notFound ? "This session isn't available" : "Couldn't load the session"}
            description={notFound ? "It may have been removed. Find another in Open Play." : "Check your connection and try again."}
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
    <PublicLayout>
      <div className="space-y-4">
        <div className="pt-2">
          <p className="m-0" style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: "0.04em", color: "var(--color-text-muted)" }}>
            {session.clinic ? "CLINIC" : "OPEN PLAY"}{session.state === "Live" ? " · ON NOW" : session.state !== "Scheduled" ? ` · ${session.state.toUpperCase()}` : ""}
          </p>
          <h1 className="m-0 mt-1 font-semibold leading-tight" style={{ fontSize: 26, letterSpacing: "-0.5px", color: "var(--color-text-dark)" }}>
            {session.title}
          </h1>
        </div>

        <div className="p-4 space-y-2.5" style={cardStyle}>
          <div className="flex items-start gap-2.5" style={rowStyle}>
            <CalendarDays className={rowIcon} />
            <span>
              {session.day}
              <br />
              {session.time}
            </span>
          </div>
          <div className="flex items-start gap-2.5" style={rowStyle}>
            <MapPin className={rowIcon} />
            <span>
              {session.venue}
              {session.address && (
                <>
                  <br />
                  <span style={{ color: "var(--color-text-muted)" }}>{session.address}</span>
                </>
              )}
            </span>
          </div>
          <div className="flex items-start gap-2.5" style={rowStyle}>
            <LayoutGrid className={rowIcon} />
            <span>{session.courts}</span>
          </div>
          <div className="flex items-start gap-2.5" style={rowStyle}>
            <Signal className={rowIcon} />
            <span>{session.level}</span>
          </div>
          {session.coach && (
            <div className="flex items-start gap-2.5" style={rowStyle}>
              <GraduationCap className={rowIcon} />
              <span>Coach {session.coach}</span>
            </div>
          )}
          {session.club && (
            <div className="flex items-start gap-2.5" style={rowStyle}>
              <UsersRound className={rowIcon} />
              <span>
                For members of{" "}
                <Link to={`/clubs/${session.club.key}`} style={{ color: "var(--color-link)", fontWeight: 600 }}>
                  {session.club.name}
                </Link>{" "}
                only
              </span>
            </div>
          )}
          <div className="flex items-start gap-2.5" style={rowStyle}>
            <Users className={rowIcon} />
            <span>
              {session.spotsLine} · <strong style={{ color: session.full ? "var(--color-error)" : "inherit" }}>{session.spots}</strong>
            </span>
          </div>
          <div className="flex items-start gap-2.5" style={rowStyle}>
            <CreditCard className={rowIcon} />
            <span>{session.paid ? `${session.fee} per player, paid online` : "Free"}</span>
          </div>
          {session.description && (
            <p className="m-0 pt-1" style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}>
              {session.description}
            </p>
          )}
          <div className="flex gap-2 pt-1 flex-wrap">
            {session.directionsUrl && (
              <Button asChild size="sm" variant="outline">
                <a href={session.directionsUrl} target="_blank" rel="noopener noreferrer">
                  <Navigation />
                  Directions
                </a>
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={handleShare}>
              <Share2 />
              Share
            </Button>
          </div>
        </div>

        {/* PLAN-009 phase D: my place in line while it runs */}
        <MyQueue queue={queue} />

        {mine ? (
          <MySpot mine={mine} cancelBy={cancelBy} onPay={handlePay} onCancel={handleCancel} isPaying={isPaying} isCancelling={isCancelling} />
        ) : !open ? (
          <div className="p-4" style={cardStyle}>
            <p className="m-0" style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>
              {session.state === "Cancelled" ? "The venue cancelled this session." : "This session is over."}
            </p>
          </div>
        ) : !signedIn ? (
          <div className="p-5" style={cardStyle}>
            <ResultState
              status="404"
              icon={<Users className="w-6 h-6" strokeWidth={1.8} />}
              title="Sign in to join"
              description="Use your Google account — your spot and the venue's emails go to it."
              action={<GoogleSignInButton returnPath={returnPath} />}
            />
          </div>
        ) : (
          <div className="space-y-2">
            {session.levelWarning && (
              <p className="m-0 flex items-start gap-2" style={{ fontSize: 13, color: "var(--color-warning)" }}>
                <CircleAlert className="size-4 shrink-0 mt-0.5" />
                {session.levelWarning}
              </p>
            )}
            <Button
              size="lg"
              className="w-full h-14 text-base font-semibold"
              onClick={handleJoin}
              disabled={isJoining || session.full || (session.paid && !session.payOnline)}
            >
              {isJoining ? <Loader2 className="animate-spin" /> : <Users className="size-5" />}
              {session.full ? "This session is full" : session.paid ? `Join · ${session.fee}` : "Join — it's free"}
            </Button>
          </div>
        )}

        {actionError && (
          <p role="alert" className="m-0 flex items-start gap-2" style={{ fontSize: 13.5, color: "var(--color-error)" }}>
            <CircleAlert className="size-4 shrink-0 mt-0.5" />
            {actionError}
          </p>
        )}

        <section>
          <SectionLabel>Who's going · {session.players.length}</SectionLabel>
          {session.players.length === 0 ? (
            <p className="m-0" style={{ fontSize: 13.5, color: "var(--color-text-muted)" }}>
              Nobody yet — be the first.
            </p>
          ) : (
            <ul className="m-0 p-0 list-none flex flex-wrap gap-2">
              {session.players.map((p, i) => (
                <li
                  key={`${p.firstName}-${i}`}
                  className="px-3 py-1.5"
                  style={{ fontSize: 13, border: "1px solid var(--color-line)", borderRadius: 999, color: "var(--color-text-dark)" }}
                >
                  {p.firstName}
                  {p.level && <span style={{ color: "var(--color-text-muted)" }}> · {p.level}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </PublicLayout>
  );
};

export default OpenPlaySessionPage;
