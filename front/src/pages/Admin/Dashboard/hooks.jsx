import { useMemo } from "react";

import { Banknote, Camera, Film, Server, Video, CalendarDays } from "lucide-react";

import { usePermissions } from "../../../hooks/usePermissions";
import {
  useGetDashboardAlerts,
  useGetDashboardStats,
  useGetDashboardVenues,
} from "../../../services/requests/admin/dashboard";
import { formatPeso } from "../../../utils/dynaCam";

const ICON = { className: "w-4.25 h-4.25", strokeWidth: 1.8 };

/** 51234 MB → "50.0 GB"; null when unknown. */
const gb = (mb) => (Number.isFinite(mb) ? `${(mb / 1024).toFixed(1)} GB` : null);

/** 3725 → "1 h 2 min", 125 → "2 min", 40 → "under a minute". */
export const durationText = (seconds) => {
  if (!Number.isFinite(seconds) || seconds < 60) return "under a minute";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} days`;
};

/**
 * One recorder box's health for the Dashboard: disk free, clock, backlog, as
 * short lines with a tone ("error" past the alert thresholds' spirit).
 */
const boxFacts = (system) => {
  if (!system) return [{ label: "Health", value: "Not reported (update the box)", tone: "muted" }];
  const facts = [];
  if (Number.isFinite(system.diskFreeMb) && system.diskTotalMb > 0) {
    const percent = Math.round((system.diskFreeMb / system.diskTotalMb) * 100);
    facts.push({
      label: "Disk free",
      value: `${gb(system.diskFreeMb)} of ${gb(system.diskTotalMb)} (${percent}%)`,
      tone: percent < 10 ? "error" : percent < 20 ? "warning" : "success",
    });
  }
  if (Number.isFinite(system.clockOffsetMs)) {
    const off = Math.abs(system.clockOffsetMs);
    facts.push({
      label: "Clock",
      value: off < 1000 ? "In sync" : `${(off / 1000).toFixed(1)}s ${system.clockOffsetMs > 0 ? "behind" : "ahead"}`,
      tone: off > 2000 ? "error" : off > 1000 ? "warning" : "success",
    });
  }
  const waiting = (system.pendingClips || 0) + (system.pendingGames || 0);
  facts.push({
    label: "Waiting to upload",
    value:
      waiting === 0
        ? "Nothing"
        : `${waiting} (oldest ${durationText(system.oldestPendingSeconds)})`,
    tone: waiting === 0 ? "success" : system.oldestPendingSeconds > 3600 ? "error" : "warning",
  });
  if (Number.isFinite(system.memTotalMb) && system.memTotalMb > 0) {
    facts.push({
      label: "Memory free",
      value: `${gb(system.memFreeMb)} of ${gb(system.memTotalMb)}`,
      tone: "muted",
    });
  }
  if (Number.isFinite(system.load1) && system.cpus) {
    facts.push({
      label: "CPU load",
      value: `${Math.round((system.load1 / system.cpus) * 100)}%`,
      tone: system.load1 / system.cpus > 0.9 ? "warning" : "muted",
    });
  }
  if (Number.isFinite(system.uptimeSeconds)) {
    facts.push({ label: "Up for", value: durationText(system.uptimeSeconds), tone: "muted" });
  }
  return facts;
};

export const useDashboardHooks = () => {
  const { hasPermission } = usePermissions();
  const canSeeAlerts = hasPermission("alerts", null, "read");

  const venuesQuery = useGetDashboardVenues();
  const alertsQuery = useGetDashboardAlerts({ enabled: canSeeAlerts });
  const statsQuery = useGetDashboardStats();

  const venues = venuesQuery.data?.data?.venues;

  const statCards = useMemo(
    () => [
      {
        title: "Recording now",
        value: venues?.recordingNow ?? 0,
        change: `of ${venues?.gamesToday ?? 0} games today`,
        icon: <Video {...ICON} />,
      },
      {
        title: "Replay clips today",
        value: venues?.clipsToday ?? 0,
        change: `${venues?.clipsReadyToday ?? 0} ready`,
        icon: <Film {...ICON} />,
      },
      {
        title: "Cash today",
        value: formatPeso(venues?.cashToday ?? 0),
        change: `${venues?.paymentsToday ?? 0} payments`,
        icon: <Banknote {...ICON} />,
      },
      {
        title: "Recorder boxes online",
        value: `${venues?.boxes?.online ?? 0}/${venues?.boxes?.total ?? 0}`,
        change: "boxes",
        icon: <Server {...ICON} />,
      },
      {
        title: "Cameras recording",
        value: `${venues?.cameras?.ok ?? 0}/${venues?.cameras?.total ?? 0}`,
        change: "cameras",
        icon: <Camera {...ICON} />,
      },
      {
        title: "Games today",
        value: venues?.gamesToday ?? 0,
        change: "booked or played",
        icon: <CalendarDays {...ICON} />,
      },
    ],
    [venues]
  );

  const problems = useMemo(
    () => alertsQuery.data?.data?.problems ?? [],
    [alertsQuery.data]
  );
  const boxes = useMemo(
    () =>
      (alertsQuery.data?.data?.boxes ?? []).map((box) => ({
        ...box,
        facts: boxFacts(box.system),
      })),
    [alertsQuery.data]
  );

  const refetch = () => {
    venuesQuery.refetch();
    if (canSeeAlerts) alertsQuery.refetch();
    statsQuery.refetch();
  };

  return {
    statCards,
    canSeeAlerts,
    problems,
    boxes,
    alertsLoading: canSeeAlerts && alertsQuery.isLoading,
    alertsError: alertsQuery.error,
    recentActivity: statsQuery.data?.data?.recentActivity ?? [],
    isLoading: venuesQuery.isLoading,
    isFetching: venuesQuery.isFetching || alertsQuery.isFetching || statsQuery.isFetching,
    error: venuesQuery.error,
    refetch,
  };
};
