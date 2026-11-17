import { useEffect, useRef } from "react";
import { Text } from "@/components/ui/text";
import useNow from "@/hooks/useNow";
import { cn } from "@/lib/utils";
import { formatElapsed, secondsSince } from "@/utils/dynaCam";

/**
 * A "12:34" timer that ticks once a second from what the API last said —
 * counting up (time recorded) or down (time until the device unpairs).
 *
 *   <TickingTimer seconds={session.elapsedSeconds} since={dataUpdatedAt}
 *                 limit={elapsed + endsIn} onLimit={refetch} />
 *   <TickingTimer direction="down" seconds={unpairInSeconds}
 *                 since={dataUpdatedAt} onLimit={unpairNow} />
 *
 *  • `seconds` is the API's value AS OF the response; `since` is that
 *    response's `dataUpdatedAt`. The tick uses only the device's own clock
 *    since then, so a device with a wrong clock or time zone still counts
 *    right. Each poll re-syncs it.
 *  • Up: never shows more than `limit`. Down: stops at 0:00.
 *  • `onLimit` fires once when the limit (or 0) is reached.
 *
 * It owns its own clock (useNow), so only this Text re-renders every second.
 */
const TickingTimer = ({
  seconds,
  since,
  direction = "up",
  limit,
  onLimit,
  className,
  accessibilityLabel,
}) => {
  const now = useNow(1000, true);
  const passed = secondsSince(since, now);
  const value =
    direction === "down"
      ? Math.max(0, Number(seconds || 0) - passed)
      : Number(seconds || 0) + passed;
  const reached =
    direction === "down" ? value <= 0 : limit != null && value >= limit;
  const shown = direction === "up" && reached ? limit : value;

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
      accessibilityLabel={
        accessibilityLabel ? `${accessibilityLabel} ${formatElapsed(shown)}` : undefined
      }
    >
      {formatElapsed(shown)}
    </Text>
  );
};

export default TickingTimer;
