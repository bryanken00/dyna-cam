import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

/**
 * A small outlined pill — coloured dot + label — for a record's state
 * ("Ready", "Unpaid", "Recording").
 *
 *   <StatusChip label="Ready" tone="success" />
 *   <StatusChip label={status} tone={CLIP_STATUS_TONE[status]} />
 *
 * Outlined, not filled: the Modern system bans pastel chips, so the colour
 * lives only on the dot and the label carries the meaning (colour is never
 * the only signal). Tones map to the accent token and the sanctioned status
 * set (design-guidelines.md §2) — warning has no token, hence the one hex.
 *
 * @param {"success"|"warning"|"danger"|"muted"} tone
 */
const DOT = {
  success: "bg-accent",
  danger: "bg-destructive",
  muted: "bg-muted-foreground",
};

const StatusChip = ({ label, tone = "muted", className }) => (
  <View
    className={cn(
      "border-border bg-card flex-row items-center gap-1.5 self-start rounded-full border px-2 py-0.5",
      className,
    )}
  >
    <View
      className={cn("h-1.5 w-1.5 rounded-full", DOT[tone])}
      style={tone === "warning" ? { backgroundColor: "#E65100" } : undefined}
    />
    <Text className="text-text-2 font-sans-medium text-[11.5px]" numberOfLines={1}>
      {label}
    </Text>
  </View>
);

export default StatusChip;
