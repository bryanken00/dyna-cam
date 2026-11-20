import dayjs from "dayjs";
import { CircleAlert, CircleCheck, Clock, Server, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import Spinner from "../../../components/Spinner";
import PageHeader from "../../../components/PageHeader";
import StatCard from "../../../components/StatCard";
import StatusDot from "../../../components/StatusDot";
import CourtBoard from "./components/CourtBoard";
import InsightsSection from "./components/InsightsSection";
import { durationText, useDashboardHooks } from "./hooks";
import RefreshButton from "../../../components/RefreshButton";

const PANEL = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-line)",
  borderRadius: "var(--radius-card)",
};

const PanelHeader = ({ icon: Icon, title, aside }) => (
  <div
    className="flex items-center gap-2 px-4.5 py-3.5"
    style={{ borderBottom: "1px solid var(--color-line)" }}
  >
    <Icon
      className="w-4 h-4 shrink-0"
      strokeWidth={1.8}
      style={{ color: "var(--color-text-muted)" }}
    />
    <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--color-text-dark)" }}>
      {title}
    </span>
    {aside && (
      <span className="ml-auto" style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
        {aside}
      </span>
    )}
  </div>
);

const EmptyRow = ({ children }) => (
  <div className="px-4.5 py-10 text-center">
    <p className="m-0" style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
      {children}
    </p>
  </div>
);

const secondsSince = (stamp) => dayjs().diff(dayjs(stamp), "second");

/** CR-008: what is wrong at the venues right now. */
const OpenProblems = ({ problems, isLoading, error }) => {
  const open = problems.filter((p) => p.status === "Open").length;
  return (
    <div className="overflow-hidden" style={PANEL}>
      <PanelHeader
        icon={TriangleAlert}
        title="Needs attention"
        aside={problems.length > 0 ? `${open} open · ${problems.length - open} checking` : null}
      />
      {isLoading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : error ? (
        <EmptyRow>Couldn't load the problems: {error.message}</EmptyRow>
      ) : problems.length === 0 ? (
        <div className="flex items-center justify-center gap-2 px-4.5 py-10">
          <CircleCheck
            className="w-4 h-4"
            strokeWidth={1.8}
            style={{ color: "var(--color-success)" }}
          />
          <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
            All courts are rolling — every box and camera is working
          </span>
        </div>
      ) : (
        problems.map((problem, i) => (
          <div
            key={problem.alertId}
            className="flex items-start justify-between gap-4 px-4.5 py-3"
            style={i === 0 ? undefined : { borderTop: "1px solid var(--color-line-soft)" }}
          >
            <div className="min-w-0">
              <StatusDot tone={problem.status === "Open" ? "error" : "warning"}>
                <span style={{ fontWeight: 500, color: "var(--color-text-dark)" }}>
                  {problem.label}
                </span>
                <span>· {problem.venueName}</span>
              </StatusDot>
              <p
                className="m-0 mt-1"
                style={{ fontSize: 12.5, color: "var(--color-text-secondary)" }}
              >
                {problem.message}
              </p>
            </div>
            <span
              className="shrink-0 text-right"
              style={{ fontSize: 12, color: "var(--color-text-muted)" }}
              title={dayjs(problem.firstSeenAt).format("MMM D, h:mm A")}
            >
              {problem.status === "Open" ? "for " : "checking · "}
              {durationText(secondsSince(problem.firstSeenAt))}
            </span>
          </div>
        ))
      )}
    </div>
  );
};

const CAMERA_TONE = { ok: "success", starting: "warning", error: "error" };

/** CR-008: each recorder box — online, its cameras and its own health. */
const RecorderBoxes = ({ boxes, isLoading, summary }) => (
  <div className="overflow-hidden" style={PANEL}>
    <PanelHeader icon={Server} title="Recorder boxes" aside={summary} />
    {isLoading ? (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    ) : boxes.length === 0 ? (
      <EmptyRow>No recorder box has connected yet</EmptyRow>
    ) : (
      boxes.map((box, i) => (
        <div
          key={box.deviceId}
          className="px-4.5 py-3.5"
          style={i === 0 ? undefined : { borderTop: "1px solid var(--color-line-soft)" }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <StatusDot tone={box.online ? "success" : "error"}>
              <span style={{ fontWeight: 500, color: "var(--color-text-dark)" }}>{box.name}</span>
              <span>· {box.venueName}</span>
            </StatusDot>
            <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
              {box.online
                ? `Online${box.agentVersion ? ` · v${box.agentVersion}` : ""}`
                : `Offline · last seen ${dayjs(box.lastSeenAt).format("MMM D, h:mm A")}`}
            </span>
          </div>

          {box.cameras.length > 0 && (
            <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-2.5">
              {box.cameras.map((camera) => (
                <StatusDot
                  key={`${camera.courtId}-${camera.camera}`}
                  tone={CAMERA_TONE[camera.status] || "muted"}
                  title={camera.message || undefined}
                >
                  {camera.courtName} · Cam {camera.camera}
                </StatusDot>
              ))}
            </div>
          )}

          {box.online && (
            <dl className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-5 gap-y-1.5 mt-3 mb-0">
              {box.facts.map((fact) => (
                <div key={fact.label} className="flex items-center justify-between gap-3 min-w-0">
                  <dt style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{fact.label}</dt>
                  <dd className="m-0 truncate">
                    <StatusDot tone={fact.tone}>{fact.value}</StatusDot>
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      ))
    )}
  </div>
);

const Dashboard = () => {
  const {
    statCards,
    courtVenues,
    dateText,
    boxSummary,
    canSeeAlerts,
    problems,
    boxes,
    alertsLoading,
    alertsError,
    insights,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useDashboardHooks();

  if (error) {
    return (
      <div className="p-8">
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Error loading dashboard</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-5">
      {/* 1. HEADER */}
      <PageHeader
        title="Today on court"
        subtitle={`${dateText ? `${dateText} · ` : ""}Every court, camera and replay at your venues. Updates every 30 seconds.`}
        actions={<RefreshButton onRefresh={refetch} isFetching={isFetching} />}
      />

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Spinner size="large" />
        </div>
      ) : (
        <>
          {/* 2. TODAY'S NUMBERS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            {statCards.map((card) => (
              <StatCard key={card.title} {...card} />
            ))}
          </div>

          {/* 3. NEEDS ATTENTION (Venue alerts permission) — first, so trouble is seen */}
          {canSeeAlerts && problems.length > 0 && (
            <OpenProblems problems={problems} isLoading={alertsLoading} error={alertsError} />
          )}

          {/* CR-023: INSIGHTS — the last 7 / 30 days, under today's numbers */}
          <InsightsSection insights={insights} />

          {/* 4. THE COURTS */}
          <CourtBoard venues={courtVenues} />

          {/* 5. RECORDER BOXES (+ the all-clear) */}
          {canSeeAlerts && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 items-start">
              {problems.length === 0 && (
                <OpenProblems problems={problems} isLoading={alertsLoading} error={alertsError} />
              )}
              <RecorderBoxes boxes={boxes} isLoading={alertsLoading} summary={boxSummary} />
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Dashboard;
