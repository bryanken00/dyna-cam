import { useMemo, useState } from "react";

import dayjs from "dayjs";
import {
  Banknote,
  Camera,
  CircleDollarSign,
  Film,
  Hourglass,
  Timer,
  Trophy,
  Video,
} from "lucide-react";

import { usePermissions } from "../../../hooks/usePermissions";
import {
  useGetDashboardAlerts,
  useGetDashboardInsights,
  useGetDashboardVenues,
} from "../../../services/requests/admin/dashboard";
import { formatMinutes, formatPeso } from "../../../utils/dynaCam";

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

/** CR-023: seconds → "1 h 12 min" (whole minutes; "0 min" when nothing). */
const minutesText = (seconds) => formatMinutes(Math.round((Number(seconds) || 0) / 60));

/** 0 → "12 AM", 13 → "1 PM"; `short` → "12a", "1p" for chart axes. */
const hourText = (hour, short = false) => {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const am = hour < 12;
  return short ? `${h12}${am ? "a" : "p"}` : `${h12} ${am ? "AM" : "PM"}`;
};

/** "+2 vs prior 7 days", "same as prior 7 days", "−1 vs prior 30 days" */
const versusText = (now, before, days) => {
  const diff = now - before;
  if (diff === 0) return `same as prior ${days} days`;
  return `${diff > 0 ? "+" : "−"}${Math.abs(diff)} vs prior ${days} days`;
};

/**
 * CR-023: the Insights section — the last 7 or 30 days. Cards, and chart data
 * for games per day, the hour games start (6 AM – 10 PM, wider when games fall
 * outside) and the weekday.
 */
const useInsights = () => {
  const [period, setPeriod] = useState(7);
  const query = useGetDashboardInsights(period);
  const insights = query.data?.data?.insights;

  const cards = useMemo(() => {
    if (!insights) return [];
    const cash = insights.cash;
    const unpaid = insights.unpaidGames;
    return [
      {
        title: "Games played",
        value: insights.gamesPlayed,
        change: versusText(insights.gamesPlayed, insights.gamesPrevious, insights.days),
        icon: <Trophy {...ICON} />,
      },
      {
        title: "Average game length",
        value: insights.gamesPlayed ? minutesText(insights.averageGameSeconds) : "—",
        change: "recorded per game",
        icon: <Timer {...ICON} />,
      },
      {
        title: "Recorded per day",
        value: minutesText(insights.recordedPerDaySeconds),
        change: `${minutesText(insights.totalRecordedSeconds)} total`,
        icon: <Hourglass {...ICON} />,
      },
      {
        title: "Not paid yet",
        value: unpaid.count,
        change:
          unpaid.count === 0
            ? "every game is paid"
            : `${unpaid.count === 1 ? "game" : "games"} · oldest ${dayjs(unpaid.oldestEndAt).format("MMM D")}`,
        icon: <CircleDollarSign {...ICON} />,
        // Opens Sessions filtered to Unpaid (all dates)
        to: "/admin/dyna-cam/sessions?payment=Unpaid",
      },
      {
        title: "Cash collected",
        value: formatPeso(cash.total),
        change: cash.gamePayments
          ? `${cash.payments} paid · ${formatPeso(cash.averagePerGame)} per game`
          : `${cash.payments} paid`,
        icon: <Banknote {...ICON} />,
      },
    ];
  }, [insights]);

  const perDay = useMemo(
    () =>
      (insights?.perDay ?? []).map((d) => ({
        label: dayjs(d.date).format(insights.days > 7 ? "MMM D" : "ddd D"),
        value: d.games,
      })),
    [insights]
  );

  const byHour = useMemo(() => {
    const rows = insights?.byHour ?? [];
    const played = rows.filter((r) => r.games > 0).map((r) => r.hour);
    const first = Math.min(6, ...played);
    const last = Math.max(22, ...played);
    return rows
      .filter((r) => r.hour >= first && r.hour <= last)
      .map((r) => ({ label: hourText(r.hour, true), value: r.games }));
  }, [insights]);

  const byWeekday = useMemo(
    () => (insights?.byWeekday ?? []).map((d) => ({ label: d.label, value: d.games })),
    [insights]
  );

  const busiestHourText = insights?.busiestHour
    ? `Busiest: ${hourText(insights.busiestHour.hour)} – ${hourText((insights.busiestHour.hour + 1) % 24)} · ${insights.busiestHour.games} ${insights.busiestHour.games === 1 ? "game" : "games"}`
    : "No games yet";
  const busiestDayText = insights?.busiestWeekday
    ? `Busiest: ${insights.busiestWeekday.label} · ${insights.busiestWeekday.games} ${insights.busiestWeekday.games === 1 ? "game" : "games"}`
    : "No games yet";
  const perDayText = insights
    ? `${insights.gamesPlayed} ${insights.gamesPlayed === 1 ? "game" : "games"} · ${minutesText(insights.totalRecordedSeconds)} recorded`
    : "";

  return {
    period,
    setPeriod,
    cards,
    perDay,
    perDayText,
    byHour,
    busiestHourText,
    byWeekday,
    busiestDayText,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
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
  // CR-040: game videos the box keeps (sent from there to Google Drive)
  if (Number.isFinite(system.localVideos)) {
    facts.push({
      label: "Videos kept",
      value:
        system.localVideos === 0
          ? "None"
          : `${system.localVideos} (${gb(system.localVideoMb || 0)})`,
      tone: "muted",
    });
  }
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

const CAMERA_WORDS = {
  ok: "recording",
  starting: "connecting",
  error: "not recording",
  offline: "box offline",
  unknown: "no report yet",
};

/** What's happening on a court, in a line: "Game on · 23 min left", "Court open", … */
const courtStatus = (game) => {
  if (game?.state === "playing") {
    if (game.openEnded) {
      return game.elapsedSeconds < 60
        ? "Game on · just started"
        : `Game on · ${durationText(game.elapsedSeconds)} played`;
    }
    return game.remainingSeconds < 60
      ? "Game on · ending now"
      : `Game on · ${durationText(game.remainingSeconds)} left`;
  }
  if (game?.state === "waiting") return "Game set up · waiting for a device";
  if (game?.state === "next") return `Next game at ${dayjs(game.startAt).format("h:mm A")}`;
  return "Court open";
};

/** A court from the API → what its card shows. */
const toCourtCard = (court) => {
  const state =
    court.game?.state === "playing" ? "playing" : court.game?.state === "waiting" ? "waiting" : "idle";
  const cameraDown = court.cameras.some((cam) => ["error", "offline"].includes(cam.status));
  const tone = cameraDown
    ? "error"
    : state === "playing"
      ? "success"
      : state === "waiting"
        ? "warning"
        : "muted";
  const cameraText =
    court.cameras.length === 0
      ? "No camera set up"
      : court.cameras
          .map((cam) => `Cam ${cam.camera} ${CAMERA_WORDS[cam.status] || cam.status}`)
          .join(" · ");
  return { ...court, state, tone, statusText: courtStatus(court.game), cameraText };
};

/** Courts grouped by venue, in the API's order (venue, then court number). */
const groupByVenue = (courts) => {
  const venues = [];
  const byId = new Map();
  for (const court of courts) {
    if (!byId.has(court.venueId)) {
      const venue = { venueId: court.venueId, venueName: court.venueName, courts: [] };
      byId.set(court.venueId, venue);
      venues.push(venue);
    }
    byId.get(court.venueId).courts.push(toCourtCard(court));
  }
  return venues.map((venue) => {
    const inPlay = venue.courts.filter((court) => court.state === "playing").length;
    const total = venue.courts.length;
    return {
      ...venue,
      summary: `${inPlay} of ${total} court${total === 1 ? "" : "s"} in play`,
    };
  });
};

export const useDashboardHooks = () => {
  const { hasPermission } = usePermissions();
  const canSeeAlerts = hasPermission("alerts", null, "read");

  const venuesQuery = useGetDashboardVenues();
  // CR-023: the last 7 / 30 days
  const insights = useInsights();
  const alertsQuery = useGetDashboardAlerts({ enabled: canSeeAlerts });

  const venues = venuesQuery.data?.data?.venues;

  const statCards = useMemo(
    () => [
      {
        title: "Games on court",
        value: venues?.recordingNow ?? 0,
        change: `of ${venues?.gamesToday ?? 0} today`,
        icon: <Video {...ICON} />,
      },
      {
        title: "Replays saved",
        value: venues?.clipsToday ?? 0,
        change: `today · ${venues?.clipsReadyToday ?? 0} ready`,
        icon: <Film {...ICON} />,
      },
      {
        title: "Cash today",
        value: formatPeso(venues?.cashToday ?? 0),
        change: `${venues?.paymentsToday ?? 0} paid`,
        icon: <Banknote {...ICON} />,
      },
      {
        title: "Cameras rolling",
        value: `${venues?.cameras?.ok ?? 0}/${venues?.cameras?.total ?? 0}`,
        change: `${venues?.boxes?.online ?? 0}/${venues?.boxes?.total ?? 0} boxes online`,
        icon: <Camera {...ICON} />,
      },
    ],
    [venues]
  );

  const courtVenues = useMemo(() => groupByVenue(venues?.courts ?? []), [venues]);
  const dateText = venues?.date ? dayjs(venues.date).format("dddd, MMMM D") : "";

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
    insights.refetch();
  };

  return {
    statCards,
    courtVenues,
    dateText,
    boxSummary: `${venues?.boxes?.online ?? 0} of ${venues?.boxes?.total ?? 0} online`,
    canSeeAlerts,
    problems,
    boxes,
    alertsLoading: canSeeAlerts && alertsQuery.isLoading,
    alertsError: alertsQuery.error,
    insights,
    isLoading: venuesQuery.isLoading,
    isFetching: venuesQuery.isFetching || alertsQuery.isFetching || insights.isFetching,
    error: venuesQuery.error,
    refetch,
  };
};
