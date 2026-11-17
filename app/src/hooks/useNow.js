import { useEffect, useState } from "react";

/**
 * `Date.now()`, re-rendered every `intervalMs` while `active` — for a running
 * timer ("Recording · 12:34"). Pass `active: false` when nothing on screen
 * is ticking, so an idle screen doesn't re-render every second.
 *
 *   const now = useNow(1000, Boolean(court.recording));
 *   formatElapsed(tickSeconds(recording.elapsedSeconds, dataUpdatedAt, now))
 */
export const useNow = (intervalMs = 1000, active = true) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, active]);

  return now;
};

export default useNow;
