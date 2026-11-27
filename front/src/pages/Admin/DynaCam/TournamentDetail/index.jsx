import { Link } from "react-router";
import dayjs from "dayjs";
import { Ban, ChevronLeft, CircleAlert, Copy, Pencil, Plus } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import { useTournamentDetailHooks } from "./hooks";
import DivisionCard from "./components/DivisionCard";
import DivisionFormDrawer from "./components/DivisionFormDrawer";
import TournamentFormDrawer from "../Tournaments/components/TournamentFormDrawer";
import { TOURNAMENT_TONE, dateRange } from "../Tournaments/hooks";
import RefreshButton from "../../../../components/RefreshButton";
import Spinner from "../../../../components/Spinner";
import StatusDot from "../../../../components/StatusDot";
import { decodeHTML } from "../../../../utils/decode-html";

/**
 * PLAN-009 phase E — DGSports → Tournaments → one tournament: open and close
 * registration, its divisions and teams, the draw, scheduling and scores.
 */
const TournamentDetailPage = () => {
  const {
    canWrite,
    canRefund,
    tournament,
    divisions,
    editable,
    nextSteps,
    isLoading,
    isFetching,
    error,
    refetch,
    handleCopy,
    handleStatus,
    handleCancel,
    busy,
    editOpen,
    handleEdit,
    handleEditClose,
    divisionOpen,
    division,
    handleNewDivision,
    handleEditDivision,
    handleDivisionClose,
  } = useTournamentDetailHooks();

  if (isLoading) {
    return (
      <div className="p-8">
        <Spinner className="py-24" tip="Loading the tournament…" />
      </div>
    );
  }
  if (error || !tournament) {
    return (
      <div className="p-8">
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Couldn't load the tournament</AlertTitle>
          <AlertDescription>{error?.response?.data?.message || "Please try again."}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-5 max-w-6xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <Link to="/admin/dyna-cam/tournaments" className="inline-flex items-center gap-1 hover:underline" style={{ fontSize: 13, color: "var(--color-link)" }}>
            <ChevronLeft className="w-3.5 h-3.5" />
            Tournaments
          </Link>
          <h1 className="m-0 mt-1 font-semibold leading-tight" style={{ fontSize: 26, letterSpacing: "-0.5px", color: "var(--color-text-dark)" }}>
            {decodeHTML(tournament.name)}
          </h1>
          <p className="m-0 mt-1 flex items-center gap-3 flex-wrap" style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}>
            <StatusDot tone={TOURNAMENT_TONE[tournament.status]}>{tournament.status}</StatusDot>
            <span>
              {dateRange(tournament.startDate, tournament.endDate)} · {tournament.dailyStart}–{tournament.dailyEnd} ·{" "}
              {decodeHTML(tournament.venueName)} · {tournament.courts.map((c) => decodeHTML(c.name)).join(", ")}
            </span>
            <span>Registration closes {dayjs(tournament.registrationClosesAt).format("MMM D, h:mm A")}</span>
          </p>
          {tournament.cancelReason && (
            <p className="m-0 mt-1" style={{ fontSize: 13, color: "var(--color-error)" }}>
              Cancelled: {decodeHTML(tournament.cancelReason)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <RefreshButton onRefresh={refetch} isFetching={isFetching} />
          {tournament.status !== "Draft" && (
            <Button variant="outline" onClick={handleCopy}>
              <Copy />
              Player link
            </Button>
          )}
          {canWrite && editable && (
            <Button variant="outline" onClick={handleEdit}>
              <Pencil />
              Edit
            </Button>
          )}
          {canWrite &&
            nextSteps.map((s) => (
              <Button key={s.status} onClick={() => handleStatus(s.status)} disabled={busy}>
                {s.label}
              </Button>
            ))}
          {canRefund && !["Finished", "Cancelled"].includes(tournament.status) && (
            <Button variant="ghost" onClick={handleCancel} disabled={busy}>
              <Ban />
              Cancel
            </Button>
          )}
        </div>
      </div>

      {divisions.length === 0 ? (
        <div className="p-10 text-center" style={{ border: "1px solid var(--color-line)", borderRadius: "var(--radius-card)" }}>
          <p className="m-0 mb-4" style={{ fontSize: 14, color: "var(--color-text-muted)" }}>
            Add a division — e.g. "Mixed Doubles 3.5" — before opening registration.
          </p>
        </div>
      ) : (
        divisions.map((d) => (
          <DivisionCard
            key={d.divisionId}
            division={d}
            courts={tournament.courts}
            canWrite={canWrite}
            canRefund={canRefund}
            editable={editable}
            onEdit={handleEditDivision}
          />
        ))
      )}
      {canWrite && editable && (
        <Button variant="outline" onClick={handleNewDivision}>
          <Plus />
          Add a division
        </Button>
      )}

      <TournamentFormDrawer open={editOpen} onClose={handleEditClose} onSuccess={handleEditClose} entity={tournament} />
      <DivisionFormDrawer open={divisionOpen} onClose={handleDivisionClose} onSuccess={handleDivisionClose} entity={division} />
    </div>
  );
};

export default TournamentDetailPage;
