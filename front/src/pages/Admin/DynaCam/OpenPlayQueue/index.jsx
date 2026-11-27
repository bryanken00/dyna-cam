import { Link } from "react-router";
import dayjs from "dayjs";
import {
  ArrowLeftRight,
  ChevronLeft,
  CircleAlert,
  Coffee,
  ListPlus,
  Pause,
  Play,
  RotateCcw,
  Trophy,
  UserCheck,
  Undo2,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

import { useOpenPlayQueueHooks } from "./hooks";
import RefreshButton from "../../../../components/RefreshButton";
import SectionLabel from "../../../../components/SectionLabel";
import Spinner from "../../../../components/Spinner";
import { decodeHTML } from "../../../../utils/decode-html";

const card = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-line)",
  borderRadius: "var(--radius-card)",
};

const Team = ({ players }) => (
  <div className="space-y-0.5">
    {players.map((p) => (
      <div key={p.playSignupId} className="truncate" style={{ fontSize: 16, fontWeight: 600, color: "var(--color-text-dark)" }}>
        {decodeHTML(p.name)}
        {p.level && <span style={{ fontSize: 12.5, fontWeight: 400, color: "var(--color-text-muted)" }}> · {p.level}</span>}
      </div>
    ))}
  </div>
);

/** A player chip in a game that hasn't started: tap to swap them with someone waiting. */
const SwapChip = ({ player, waiting, onSwap, disabled }) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild disabled={disabled || waiting.length === 0}>
      <button
        type="button"
        className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-md transition-colors hover:bg-(--color-surface-sunken)"
        style={{ fontSize: 13.5, border: "1px solid var(--color-line)", color: "var(--color-text-dark)" }}
      >
        {decodeHTML(player.name)}
        <ArrowLeftRight className="w-3.5 h-3.5" style={{ color: "var(--color-text-muted)" }} />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start">
      <DropdownMenuLabel>Swap {decodeHTML(player.name)} with…</DropdownMenuLabel>
      {waiting.map((w) => (
        <DropdownMenuItem key={w.playSignupId} onClick={() => onSwap(player.playSignupId, w.playSignupId)}>
          {w.place}. {decodeHTML(w.name)}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
);

/**
 * PLAN-009 phase D — DGSports → Open Play → a session's queue, for a tablet at
 * the court. Courts show their games (enter the score, End game: the court
 * takes the next game); Next up shows the games waiting for a court, with why
 * those four; the line is everyone checked in, longest-waiting first.
 */
const OpenPlayQueuePage = () => {
  const {
    canWrite,
    title,
    session,
    queue,
    isLoading,
    isFetching,
    error,
    refetch,
    scores,
    handleScore,
    handleEnd,
    handleVoid,
    handleFill,
    handleLineUp,
    handlePause,
    handleSwap,
    handleRest,
    handleCheckIn,
    busy,
  } = useOpenPlayQueueHooks();

  if (isLoading) {
    return (
      <div className="p-8">
        <Spinner className="py-24" tip="Loading the queue…" />
      </div>
    );
  }
  if (error || !queue) {
    return (
      <div className="p-8">
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Couldn't load the queue</AlertTitle>
          <AlertDescription>{error?.response?.data?.message || "Please try again."}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const running = session && (session.state === "Scheduled" || session.state === "Live");
  const write = canWrite && running;
  const freeCourts = queue.courts.filter((c) => !c.game).length;

  return (
    <div className="p-6 lg:p-8 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <Link to="/admin/dyna-cam/open-play" className="inline-flex items-center gap-1 hover:underline" style={{ fontSize: 13, color: "var(--color-link)" }}>
            <ChevronLeft className="w-3.5 h-3.5" />
            Open Play
          </Link>
          <h1 className="m-0 mt-1 font-semibold leading-tight truncate" style={{ fontSize: 24, color: "var(--color-text-dark)" }}>
            {title}
          </h1>
          {session && (
            <p className="m-0 mt-0.5" style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}>
              {dayjs(session.startAt).format("ddd, MMM D · h:mm A")} – {dayjs(session.endAt).format("h:mm A")} · {session.state}
              {queue.paused ? " · queue paused" : ""}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <RefreshButton onRefresh={refetch} isFetching={isFetching} />
          {write && (
            <>
              <Button variant="outline" onClick={handlePause} disabled={busy}>
                {queue.paused ? <Play /> : <Pause />}
                {queue.paused ? "Resume queue" : "Pause queue"}
              </Button>
              <Button onClick={handleFill} disabled={busy || freeCourts === 0 || queue.paused}>
                <Play />
                Fill free courts
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Courts */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {queue.courts.map((c) => (
          <div key={c.courtId} className="p-4 space-y-3" style={{ ...card, borderColor: c.game ? "var(--color-link)" : "var(--color-line)" }}>
            <div className="flex items-center justify-between">
              <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.04em", color: "var(--color-text-muted)" }}>
                {decodeHTML(c.name).toUpperCase()}
              </span>
              {c.game?.startedAt && (
                <span style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>since {dayjs(c.game.startedAt).format("h:mm A")}</span>
              )}
            </div>
            {c.game ? (
              <>
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                  <Team players={c.game.teamA} />
                  <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>vs</span>
                  <Team players={c.game.teamB} />
                </div>
                {write && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <Input
                      aria-label="Team A's score"
                      inputMode="numeric"
                      placeholder="A"
                      className="h-10 w-16 text-center"
                      value={scores[c.game.playGameId]?.a || ""}
                      onChange={(e) => handleScore(c.game.playGameId, "a", e.target.value)}
                    />
                    <span style={{ color: "var(--color-text-muted)" }}>–</span>
                    <Input
                      aria-label="Team B's score"
                      inputMode="numeric"
                      placeholder="B"
                      className="h-10 w-16 text-center"
                      value={scores[c.game.playGameId]?.b || ""}
                      onChange={(e) => handleScore(c.game.playGameId, "b", e.target.value)}
                    />
                    <Button className="h-10" onClick={() => handleEnd(c.game)} disabled={busy}>
                      <Trophy />
                      End game
                    </Button>
                    <Button variant="ghost" className="h-10" onClick={() => handleVoid(c.game)} disabled={busy}>
                      <Undo2 />
                      Call off
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <p className="m-0 py-3" style={{ fontSize: 14, color: "var(--color-text-muted)" }}>
                Free{queue.waiting.length < 4 ? ` — ${queue.waiting.length} waiting, a game needs 4` : ""}
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        {/* Next up */}
        <div className="p-5" style={card}>
          <div className="flex items-center justify-between gap-3 mb-3">
            <SectionLabel>Next up · {queue.next.length}</SectionLabel>
            {write && (
              <Button size="sm" variant="outline" onClick={handleLineUp} disabled={busy || queue.waiting.length < 4}>
                <ListPlus />
                Line up a game
              </Button>
            )}
          </div>
          {queue.next.length === 0 ? (
            <p className="m-0" style={{ fontSize: 13.5, color: "var(--color-text-muted)" }}>
              Games are made from the line as courts free up.
            </p>
          ) : (
            <ol className="m-0 p-0 list-none space-y-3">
              {queue.next.map((g, i) => (
                <li key={g.playGameId} className="p-3 space-y-2" style={{ border: "1px solid var(--color-line)", borderRadius: 10 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text-muted)" }}>Game {i + 1}</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {g.teamA.map((p) => (
                      <SwapChip key={p.playSignupId} player={p} waiting={queue.waiting} disabled={!write || busy} onSwap={(o, n) => handleSwap(g, o, n)} />
                    ))}
                    <span style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>vs</span>
                    {g.teamB.map((p) => (
                      <SwapChip key={p.playSignupId} player={p} waiting={queue.waiting} disabled={!write || busy} onSwap={(o, n) => handleSwap(g, o, n)} />
                    ))}
                  </div>
                  {g.reason && (
                    <p className="m-0" style={{ fontSize: 12.5, color: "var(--color-text-secondary)" }}>
                      Why these 4: {decodeHTML(g.reason)}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* The line */}
        <div className="p-5 space-y-5" style={card}>
          <div>
            <SectionLabel>Waiting · {queue.waiting.length}</SectionLabel>
            {queue.waiting.length === 0 ? (
              <p className="m-0" style={{ fontSize: 13.5, color: "var(--color-text-muted)" }}>
                Nobody waiting.
              </p>
            ) : (
              <ol className="m-0 p-0 list-none space-y-1.5">
                {queue.waiting.map((w) => (
                  <li key={w.playSignupId} className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate" style={{ fontSize: 14, color: "var(--color-text-dark)" }}>
                      <span className="font-mono" style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                        {String(w.place).padStart(2, "0")}
                      </span>{" "}
                      {decodeHTML(w.name)}
                      <span style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
                        {" "}
                        · {w.level || "no level"} · {w.gamesPlayed} played
                      </span>
                    </span>
                    {write && (
                      <Button size="sm" variant="ghost" onClick={() => handleRest(w, true)} disabled={busy}>
                        <Coffee />
                        Rest
                      </Button>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>

          {queue.resting.length > 0 && (
            <div>
              <SectionLabel>Resting · {queue.resting.length}</SectionLabel>
              <ul className="m-0 p-0 list-none space-y-1.5">
                {queue.resting.map((r) => (
                  <li key={r.playSignupId} className="flex items-center justify-between gap-3" style={{ fontSize: 14 }}>
                    <span className="truncate">{decodeHTML(r.name)}</span>
                    {write && (
                      <Button size="sm" variant="ghost" onClick={() => handleRest(r, false)} disabled={busy}>
                        <RotateCcw />
                        Back in line
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {queue.notHere.length > 0 && (
            <div>
              <SectionLabel>Not checked in · {queue.notHere.length}</SectionLabel>
              <ul className="m-0 p-0 list-none space-y-1.5">
                {queue.notHere.map((n) => (
                  <li key={n.playSignupId} className="flex items-center justify-between gap-3" style={{ fontSize: 14 }}>
                    <span className="truncate" style={{ color: "var(--color-text-secondary)" }}>
                      {decodeHTML(n.name)}
                    </span>
                    {write && (
                      <Button size="sm" variant="outline" onClick={() => handleCheckIn(n)} disabled={busy}>
                        <UserCheck />
                        Here
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {queue.recent.length > 0 && (
        <div className="p-5" style={card}>
          <SectionLabel>Last games</SectionLabel>
          <ul className="m-0 p-0 list-none space-y-1.5">
            {queue.recent.map((g) => (
              <li key={g.playGameId} style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}>
                {g.teamA.map((p) => decodeHTML(p.name)).join(" & ")}{" "}
                <strong style={{ color: "var(--color-text-dark)" }}>
                  {g.scoreA ?? "–"} – {g.scoreB ?? "–"}
                </strong>{" "}
                {g.teamB.map((p) => decodeHTML(p.name)).join(" & ")}
                <span style={{ color: "var(--color-text-muted)" }}> · {dayjs(g.endedAt).format("h:mm A")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default OpenPlayQueuePage;
