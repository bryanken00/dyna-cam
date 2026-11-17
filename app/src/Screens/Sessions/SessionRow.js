import { MoreVertical } from "lucide-react-native";
import { memo } from "react";
import { Pressable, View } from "react-native";
import StatusChip from "@/components/StatusChip";
import { Text } from "@/components/ui/text";
import { useThemeColors } from "@/hooks/useTheme";
import {
  SESSION_STATUS_TONE,
  formatDayLabel,
  formatMinutes,
  formatTimeRange,
} from "@/utils/dynaCam";

/** "3 / 12 parts" once the session has started making parts. */
export const partsProgress = (session) =>
  ["Recording", "Processing", "Ready", "Failed"].includes(session.status) &&
  session.partsTotal > 0
    ? `${session.partsReady} / ${session.partsTotal} parts`
    : null;

/**
 * One session:
 *
 *   Court 1 · Dink City                 [● Recording]  ⋮
 *   Today · 2:00 PM – 3:00 PM · 1 h
 *   Marco Reyes · 3 / 12 parts
 *
 * `onMenu` is omitted when there is nothing the user may do to it.
 */
const SessionRow = ({ session, onPress, onMenu }) => {
  const colors = useThemeColors();
  const progress = partsProgress(session);
  const extra = [session.playerName, progress].filter(Boolean).join("  ·  ");

  return (
    <Pressable
      onPress={() => onPress(session)}
      accessibilityRole="button"
      accessibilityLabel={`${session.courtName}, ${formatDayLabel(session.startAt?.slice(0, 10))}, ${session.status}`}
      className="flex-row items-center gap-3 px-4 py-3 active:bg-secondary/60"
    >
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="font-sans-medium text-[14px]" numberOfLines={1}>
          {session.courtName}
          <Text className="text-muted-foreground text-[12.5px]">
            {`  ·  ${session.venueName}`}
          </Text>
        </Text>
        <Text className="text-text-2 text-[12.5px]" numberOfLines={1}>
          {`${formatDayLabel(session.startAt?.slice(0, 10))}  ·  ${formatTimeRange(session.startAt, session.endAt)}  ·  ${formatMinutes(session.durationMinutes)}`}
        </Text>
        {extra ? (
          <Text className="text-muted-foreground text-[12.5px]" numberOfLines={1}>
            {extra}
          </Text>
        ) : null}
      </View>

      <StatusChip
        label={session.status}
        tone={SESSION_STATUS_TONE[session.status] ?? "muted"}
      />

      {onMenu ? (
        <Pressable
          onPress={() => onMenu(session)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Session actions"
          className="h-8 w-8 items-center justify-center rounded-lg active:bg-secondary"
        >
          <MoreVertical size={16} color={colors.mutedForeground} />
        </Pressable>
      ) : null}
    </Pressable>
  );
};

export default memo(SessionRow);
