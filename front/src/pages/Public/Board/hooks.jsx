import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";

import { decodeHTML } from "../../../utils/decode-html";
import { useGetCourtBoard } from "../../../services/requests/public/board";

// The controls and the cursor hide after this long without the mouse moving
const IDLE_MS = 3000;

/**
 * The board reply in the shape CourtDayGrid draws (its Admin day). The public
 * reply has no IDs, so the grid's keys are made up here; there are no names
 * or codes to pass on.
 */
const toGridDay = (board) => ({
  date: board.date,
  hours: board.hours,
  courts: board.courts.map((c) => ({ courtId: c.key, name: c.name, status: "Active" })),
  bookings: board.bookings.map((b, i) => ({
    bookingId: `b${i}`,
    courtId: b.courtKey,
    status: b.status,
    startAt: b.startAt,
    endAt: b.endAt,
  })),
  games: board.games.map((g, i) => ({
    sessionId: `g${i}`,
    courtId: g.courtKey,
    bookingId: null,
    status: g.status,
    startAt: g.startAt,
    endAt: g.endAt,
    openEnded: g.openEnded,
  })),
  closures: board.closures.map((c, i) => ({
    closureId: `c${i}`,
    courtId: c.courtKey,
    startAt: c.startAt,
    endAt: c.endAt,
  })),
});

/**
 * `/board/:displayToken` (CR-038): a venue's TV court board. Polls every minute;
 * full screen on a click (the browser needs one); keeps the screen awake where
 * the browser allows it; hides its button and the cursor when the mouse rests.
 */
export const useBoardPageHooks = () => {
  const { displayToken } = useParams();
  const { data, isLoading, error, refetch, isFetching } = useGetCourtBoard(displayToken);
  const [isFullscreen, setIsFullscreen] = useState(() => !!document.fullscreenElement);
  const [idle, setIdle] = useState(false);

  const board = data?.data || null;
  const day = useMemo(() => (board ? toGridDay(board) : null), [board]);

  // Full screen: follow the browser (Esc, F11) as well as the button
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      document.documentElement.requestFullscreen?.().catch(() => {});
    }
  }, []);

  // Keep the TV's screen on while the board shows (re-asked when the tab comes back)
  useEffect(() => {
    if (!("wakeLock" in navigator)) return undefined;
    let lock = null;
    const ask = async () => {
      try {
        if (document.visibilityState === "visible") lock = await navigator.wakeLock.request("screen");
      } catch {
        // Not allowed here (no gesture, power saving): the board still works
      }
    };
    ask();
    document.addEventListener("visibilitychange", ask);
    return () => {
      document.removeEventListener("visibilitychange", ask);
      lock?.release?.().catch(() => {});
    };
  }, []);

  // Hide the button and the cursor when the mouse rests
  useEffect(() => {
    let timer = setTimeout(() => setIdle(true), IDLE_MS);
    const wake = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), IDLE_MS);
    };
    window.addEventListener("mousemove", wake);
    window.addEventListener("keydown", wake);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousemove", wake);
      window.removeEventListener("keydown", wake);
    };
  }, []);

  return {
    board,
    day,
    venueName: decodeHTML(board?.venue?.name),
    isLoading,
    isFetching,
    notFound: error?.response?.status === 404 || error?.response?.status === 400,
    loadError: error && error?.response?.status !== 404 && error?.response?.status !== 400 && !board,
    refetch,
    isFullscreen,
    handleToggleFullscreen,
    idle,
  };
};
