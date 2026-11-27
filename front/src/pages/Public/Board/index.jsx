import dayjs from "dayjs";
import { Maximize2, Minimize2, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

import { useBoardPageHooks } from "./hooks";
import BoardClock from "./components/BoardClock";
import OpenPlayPanel from "./components/OpenPlayPanel";
import TournamentPanel from "./components/TournamentPanel";
import CourtDayGrid from "../../../components/CourtDayGrid";
import DGMark from "../../../components/brand/DGMark";
import Wordmark from "../../../components/brand/Wordmark";
import ResultState from "../../../components/ResultState";
import Spinner from "../../../components/Spinner";
import { BOARD_TONE, formatHour } from "../../../utils/dynaCam";

// The grid's own colours, so the legend always matches the blocks
const LEGEND = [
  { label: "Free", tone: BOARD_TONE.free },
  { label: "Booked", tone: BOARD_TONE.booked },
  { label: "In play", tone: BOARD_TONE.playing },
  { label: "Played / closed", tone: BOARD_TONE.done },
];

const Screen = ({ children, idle }) => (
  <div
    className="h-dvh w-full flex flex-col overflow-hidden"
    style={{ background: "var(--color-canvas)", color: "var(--color-text-dark)", cursor: idle ? "none" : undefined }}
  >
    {children}
  </div>
);

/**
 * `/board/:displayToken` (CR-038) — a venue's TV court board: the logo, the
 * venue, today's date and a live clock, then every court across the screen
 * (CourtDayGrid `display`: free / booked / in play / closed with times — no
 * names, booking codes or IDs; the API never sends them). No login: the link
 * staff turn on from the venue page is the credential. Refreshes every minute.
 */
const BoardPage = () => {
  const {
    board,
    day,
    venueName,
    isLoading,
    isFetching,
    notFound,
    loadError,
    refetch,
    isFullscreen,
    handleToggleFullscreen,
    idle,
  } = useBoardPageHooks();

  if (isLoading) {
    return (
      <Screen>
        <Spinner className="py-32" tip="Loading the courts…" />
      </Screen>
    );
  }

  if (notFound) {
    return (
      <Screen>
        <ResultState
          status="404"
          title="This board link isn't valid"
          description="It was turned off or replaced. Ask the venue's staff for the current TV board link."
        />
      </Screen>
    );
  }

  if (loadError || !board) {
    return (
      <Screen>
        <ResultState
          status="error"
          title="Couldn't load the courts"
          description="Check the connection — the board tries again every minute."
          action={
            <Button onClick={() => refetch()} disabled={isFetching}>
              <RotateCcw />
              Try again
            </Button>
          }
        />
      </Screen>
    );
  }

  return (
    <Screen idle={idle}>
      {/* Header */}
      <header
        className="shrink-0 flex items-center justify-between gap-6 px-8 py-5"
        style={{ background: "var(--color-brand-court)", color: "var(--color-brand-on-court)" }}
      >
        <div className="flex items-center gap-4 min-w-0">
          <DGMark size={40} tile={false} />
          <Wordmark size={26} onBrand />
          <span className="mx-2 h-10 w-px shrink-0" style={{ background: "rgb(255 255 255 / 0.3)" }} />
          <div className="min-w-0">
            <div className="truncate" style={{ fontSize: "clamp(20px, 2.2vw, 34px)", fontWeight: 600, lineHeight: 1.15 }}>
              {venueName}
            </div>
            <div style={{ fontSize: "clamp(14px, 1.3vw, 20px)", opacity: 0.8 }}>
              {dayjs(board.date).format("dddd, MMMM D")}
              {board.hours
                ? ` · open ${formatHour(board.hours.opensAt)} – ${formatHour(board.hours.closesAt)}`
                : " · closed today"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-5 shrink-0">
          <BoardClock />
          <Button
            type="button"
            variant="outline"
            className={`btn-on-court transition-opacity ${idle ? "opacity-0" : "opacity-80 hover:opacity-100"}`}
            onClick={handleToggleFullscreen}
            aria-label={isFullscreen ? "Leave full screen" : "Full screen"}
          >
            {isFullscreen ? <Minimize2 /> : <Maximize2 />}
            {isFullscreen ? "Exit full screen" : "Full screen"}
          </Button>
        </div>
      </header>

      {/* Legend */}
      <div
        className="shrink-0 flex items-center gap-7 px-8 py-3 flex-wrap"
        style={{ borderBottom: "1px solid var(--color-line)", background: "var(--color-surface)" }}
      >
        {LEGEND.map(({ label, tone }) => (
          <span
            key={label}
            className="inline-flex items-center gap-2.5"
            style={{ fontSize: "clamp(14px, 1.2vw, 19px)", color: "var(--color-text-secondary)" }}
          >
            <span className="inline-block w-3.5 h-3.5 rounded-full" style={{ background: tone }} />
            {label}
          </span>
        ))}
        <span className="ml-auto" style={{ fontSize: "clamp(13px, 1.1vw, 17px)", color: "var(--color-text-muted)" }}>
          Book a court online
        </span>
      </div>

      {/* PLAN-009 phase D: Open Play running now — its courts, next games and line */}
      {(board?.openPlay || []).map((session) => (
        <OpenPlayPanel key={`${session.title}-${session.startAt}`} session={session} />
      ))}

      {/* PLAN-009 phase E: a tournament on today */}
      {(board?.tournaments || []).map((t) => (
        <TournamentPanel
          key={t.name}
          tournament={t}
          courtName={(courtKey) => board.courts.find((c) => c.key === courtKey)?.name || null}
        />
      ))}

      {/* Today */}
      <div className="flex-1 min-h-0" style={{ background: "var(--color-surface)" }}>
        {day.courts.length === 0 ? (
          <p className="m-0 py-24 text-center" style={{ fontSize: 20, color: "var(--color-text-muted)" }}>
            No courts at this venue yet
          </p>
        ) : (
          <CourtDayGrid day={day} display />
        )}
      </div>
    </Screen>
  );
};

export default BoardPage;
