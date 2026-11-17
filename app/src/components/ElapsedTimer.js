import { useEffect, useRef } from "react";
import { Text } from "@/components/ui/text";
import useNow from "@/hooks/useNow";
import { cn } from "@/lib/utils";
import { formatElapsed, tickSeconds } from "@/utils/dynaCam";

/**
 * A running "12:34" / "1:02:34" timer for a recording, ticking once a second
 * from what the API last said. It owns its own clock (useNow), so only this
 * Text re-renders every second — not the screen or list around it.
 *
 *   <ElapsedTimer
 *     seconds={recording.elapsedSeconds}   // as of the response
 *     since={query.dataUpdatedAt}          // when that response arrived
 *     limit={recording.elapsedSeconds + recording.endsInSeconds}
 *     onLimit={refresh}                    // it stopped by itself — re-read
 *     className="font-mono text-[48px]"
 *   />
 *
 * The display never runs past `limit` (the automatic stop); `onLimit` fires
 * once when it gets there, so the screen can refresh the court.
 */
const ElapsedTimer = ({ seconds, since, limit, onLimit, className }) => {
  const now = useNow(1000, true);
  const raw = tickSeconds(seconds, since, now);
  const reached = limit != null && raw >= limit;
  const shown = reached ? limit : raw;

  const fired = useRef(false);
  useEffect(() => {
    if (reached && !fired.current) {
      fired.current = true;
      onLimit?.();
    }
    if (!reached) fired.current = false;
  }, [reached, onLimit]);

  return (
    <Text
      className={cn("font-mono", className)}
      accessibilityLabel={`Recording for ${formatElapsed(shown)}`}
    >
      {formatElapsed(shown)}
    </Text>
  );
};

export default ElapsedTimer;
