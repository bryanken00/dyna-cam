import { ChevronRight, QrCode } from "lucide-react-native";
import { memo } from "react";
import { Pressable, View } from "react-native";
import StatusChip from "@/components/StatusChip";
import { Text } from "@/components/ui/text";
import { useThemeColors } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import {
  CLIP_SOURCE_LABEL,
  formatDateTime,
  formatGameLength,
  formatPeso,
} from "@/utils/dynaCam";

/** Paired-API clip status → chip ("Pending" means still saving). */
const clipChip = (clip) => {
  switch (clip.status) {
    case "Pending":
      return { label: "Saving…", tone: "warning" };
    case "Ready":
      return { label: "Ready", tone: "success" };
    case "Failed":
      return { label: "Failed", tone: "danger" };
    default:
      return { label: clip.status, tone: "muted" };
  }
};

/** AppSession status → chip. */
const gameChip = (game) => {
  switch (game.status) {
    case "Recording":
      return { label: "Recording", tone: "danger" };
    case "Processing":
      return {
        label: game.partsTotal
          ? `Saving… ${game.partsReady}/${game.partsTotal}`
          : "Saving…",
        tone: "warning",
      };
    case "Ready":
      return { label: "Ready", tone: "success" };
    case "Failed":
      return { label: "Failed", tone: "danger" };
    case "Scheduled":
      return { label: "Booked", tone: "muted" };
    default:
      return { label: game.status, tone: "muted" };
  }
};

/** Nothing to hand a player for these — the row isn't tappable. */
const DEAD = ["Failed", "Expired", "Cancelled"];

/**
 * One entry in a court's "Recent" — a whole game or a 60-second clip:
 *
 *   Game · 42 min                              ⌗ ›
 *   Today, 7:02 PM   [● Ready]  [by Front desk phone]
 *
 *   Clip · 60 s                                ⌗ ›
 *   Today, 6:58 PM   [● Ready]  [QR scan]  [● Unpaid · ₱50]
 *
 * Tap → that game's or clip's QR again. Memoised: the list re-renders while
 * a game is polled.
 */
const RecentRow = ({ entry, onPress }) => {
  const colors = useThemeColors();
  const { kind, item } = entry;
  const isGame = kind === "session";
  const chip = isGame ? gameChip(item) : clipChip(item);
  const canShow = !DEAD.includes(item.status);

  const label = isGame
    ? `Game · ${item.status === "Recording" ? "recording" : formatGameLength(item.durationSeconds)}`
    : `Clip · ${item.durationSeconds || 60} s`;
  const when = formatDateTime(isGame ? item.startAt : item.requestedAt);

  return (
    <Pressable
      onPress={() => onPress(kind, item)}
      disabled={!canShow}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${when}, ${chip.label}.${canShow ? " Show its QR." : ""}`}
      className={cn(
        "min-h-[64px] flex-row items-center gap-3 px-4 py-3",
        canShow ? "active:bg-secondary/60" : "opacity-60",
      )}
    >
      <View className="min-w-0 flex-1 gap-1">
        <Text className="font-sans-semibold text-[15px]" numberOfLines={1}>
          {label}
        </Text>
        <Text className="text-muted-foreground text-[12.5px]" numberOfLines={1}>
          {isGame && item.startedBy ? `${when} · by ${item.startedBy}` : when}
        </Text>
        <View className="flex-row flex-wrap gap-1.5">
          <StatusChip label={chip.label} tone={chip.tone} />
          {!isGame ? (
            <StatusChip
              label={CLIP_SOURCE_LABEL[item.source] ?? item.source}
              tone="muted"
            />
          ) : null}
          {!isGame && item.paymentStatus === "Unpaid" ? (
            <StatusChip label={`Unpaid · ${formatPeso(item.price)}`} tone="warning" />
          ) : !isGame && item.paymentStatus === "Paid" ? (
            <StatusChip label="Paid" tone="success" />
          ) : null}
        </View>
      </View>
      {canShow ? (
        <View className="flex-row items-center gap-1">
          <QrCode size={18} color={colors.mutedForeground} />
          <ChevronRight size={18} color={colors.mutedForeground} />
        </View>
      ) : null}
    </Pressable>
  );
};

export default memo(RecentRow);
