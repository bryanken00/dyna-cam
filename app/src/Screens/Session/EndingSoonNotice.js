import { Timer } from "lucide-react-native";
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import useNow from "@/hooks/useNow";
import { cn } from "@/lib/utils";
import { formatElapsed, formatTime, secondsSince } from "@/utils/dynaCam";

/** CR-016: the notice shows in the last this-many seconds of the game time. */
export const ENDING_SOON_SECONDS = 5 * 60;

/** The fixed warning pair (design-guidelines §2) — the token set has no warning role. */
const WARNING_FG = "#E65100";

/**
 * CR-016 "5 minutes left": a game with a game time stops by itself, so in its
 * last 5 minutes the courtside device says so, with a countdown and the stop
 * time. When staff Add time on the web, the next poll moves `endsInSeconds`
 * and the notice goes away by itself.
 *
 *   <EndingSoonNotice session={s} since={m.since} />
 *
 * Ticks from the API's `endsInSeconds` + the time since that answer (never
 * the device clock against `endAt`). Renders nothing for an open game, or
 * while more than 5 minutes are left.
 */
const EndingSoonNotice = ({ session, since, className }) => {
  const timed = session?.status === "Recording" && !session.openEnded;
  // Only tick while it could show: the last 5 minutes of a timed game
  const near = timed && Number(session.endsInSeconds ?? 0) <= ENDING_SOON_SECONDS + 60;
  const now = useNow(1000, near);
  if (!near) return null;

  const left = Math.max(0, Number(session.endsInSeconds ?? 0) - secondsSince(since, now));
  if (left <= 0 || left > ENDING_SOON_SECONDS) return null;

  return (
    <View
      className={cn(
        "flex-row items-center gap-3 rounded-xl border border-[#E65100] bg-[#FFF3E0] px-4 py-3",
        className,
      )}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Timer size={20} color={WARNING_FG} />
      <View className="min-w-0 flex-1">
        <Text className="font-sans-bold text-[15px] text-[#E65100]">
          {`${Math.ceil(left / 60)} ${Math.ceil(left / 60) === 1 ? "minute" : "minutes"} left`}
        </Text>
        <Text className="text-[13px] text-[#E65100]">
          {`Recording stops at ${formatTime(session.endAt)}. Want more time? Ask the front desk.`}
        </Text>
      </View>
      <Text
        className="font-mono text-[18px] text-[#E65100]"
        accessibilityLabel={`${formatElapsed(left)} left`}
      >
        {formatElapsed(left)}
      </Text>
    </View>
  );
};

export default EndingSoonNotice;
