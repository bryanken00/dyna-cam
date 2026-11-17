import { ChevronRight } from "lucide-react-native";
import { memo } from "react";
import { Pressable, View } from "react-native";
import StatusChip from "@/components/StatusChip";
import { Text } from "@/components/ui/text";
import { useThemeColors } from "@/hooks/useTheme";

/** What a court can do right now, in one chip. */
export const courtState = (court) => {
  if (court.status !== "Active") return { label: court.status, tone: "muted" };
  if (!court.camera?.configured) return { label: "No camera", tone: "muted" };
  if (!court.recorderOnline) return { label: "Box offline", tone: "danger" };
  return { label: "Recording", tone: "success" };
};

/**
 * One court in the list:
 *
 *   Court 1                         ● Recording  ›
 *   Dink City Pickleball · dink-city-court-1
 *
 * Memoised — the list re-renders on every keystroke in the search box.
 */
const CourtRow = ({ court, onPress }) => {
  const colors = useThemeColors();
  const state = courtState(court);

  return (
    <Pressable
      onPress={() => onPress(court)}
      accessibilityRole="button"
      accessibilityLabel={`${court.name}, ${court.venueName}, ${state.label}`}
      className="flex-row items-center gap-3 px-4 py-3 active:bg-secondary/60"
    >
      <View className="min-w-0 flex-1">
        <Text className="font-sans-medium text-[14px]" numberOfLines={1}>
          {court.name}
        </Text>
        <Text
          className="text-muted-foreground mt-0.5 text-[12.5px]"
          numberOfLines={1}
        >
          {court.venueName}
          {court.buttonCode ? (
            <Text className="text-muted-foreground font-mono text-[11.5px]">
              {`  ·  ${court.buttonCode}`}
            </Text>
          ) : null}
        </Text>
      </View>

      <StatusChip label={state.label} tone={state.tone} />
      <ChevronRight size={16} color={colors.mutedForeground} />
    </Pressable>
  );
};

export default memo(CourtRow);
