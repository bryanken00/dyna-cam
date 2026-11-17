import { View } from "react-native";
import DotsLoader from "@/components/Loading/DotsLoader";
import { Text } from "@/components/ui/text";
import { useThemeColors } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

const PLATFORM = { FACEBOOK: "Facebook", YOUTUBE: "YouTube" };

/** The player's stream → what the chip says, and its dot. */
export const describeStream = (stream) => {
  const where = PLATFORM[stream.platform] ?? "their stream";
  switch (stream.status) {
    case "live":
      return { text: `Streaming to ${where} · Live`, tone: "live" };
    case "starting":
      return { text: `Streaming to ${where} · Connecting…`, tone: "busy" };
    case "waiting":
      return { text: `Streaming to ${where} · Starts with the game`, tone: "muted" };
    case "error":
      return {
        text: stream.message ? `Stream problem — ${stream.message}` : "Stream problem",
        tone: "error",
      };
    default:
      return { text: `Streaming to ${where}`, tone: "muted" };
  }
};

/**
 * The player's own live stream (PLAN-002 Phase G), as a slim strip under the
 * header: "● Streaming to Facebook · Live", "Connecting…", "Starts with the
 * game" or "Stream problem — <message>". One line, fixed height, so it moves
 * the video and QR down by the same small amount whatever it says.
 */
const StreamChip = ({ stream, className }) => {
  const colors = useThemeColors();
  const { text, tone } = describeStream(stream);

  return (
    <View
      className={cn(
        "border-border bg-card h-10 flex-row items-center gap-2 border-b px-4",
        className,
      )}
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
    >
      {tone === "busy" ? (
        <DotsLoader color={colors.mutedForeground} size={12} />
      ) : (
        <View
          className={cn(
            "h-2.5 w-2.5 rounded-full",
            tone === "live"
              ? "bg-accent"
              : tone === "error"
                ? "bg-destructive"
                : "bg-muted-foreground",
          )}
        />
      )}
      <Text
        className={cn(
          "min-w-0 flex-1 text-[13.5px]",
          tone === "error" ? "text-destructive font-sans-medium" : "font-sans-medium",
        )}
        numberOfLines={1}
      >
        {text}
      </Text>
    </View>
  );
};

export default StreamChip;
