import { useNavigation } from "@react-navigation/native";
import { Banknote, ChevronRight, MapPin, Settings2 } from "lucide-react-native";
import { FlatList, Pressable, RefreshControl, View } from "react-native";
import ConnectionBanner from "@/components/ConnectionBanner";
import ElapsedTimer from "@/components/ElapsedTimer";
import DotsLoader from "@/components/Loading/DotsLoader";
import QueryState from "@/components/QueryState";
import ScreenHeader from "@/components/ScreenHeader";
import StatusChip from "@/components/StatusChip";
import { EmptyState } from "@/components/pattern";
import { Text } from "@/components/ui/text";
import { SCREEN_NAVIGATION } from "@/constants/navigations";
import { useThemeColors } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import { isConnectionError } from "@/utils/dynaCam";
import PairedSettingsSheet from "../PairedSettingsSheet";
import { pairedCourtState } from "../courtState";
import { usePairedCourts } from "./usePairedCourts";

/**
 * "● Recording · 12:34" — filled red, unlike the outlined status chips, so a
 * court that is recording a whole game stands out in the list. Ticks locally.
 */
const RecordingBadge = ({ recording, since }) => (
  <View className="bg-destructive flex-row items-center gap-2 self-start rounded-full px-3 py-1">
    <View className="bg-destructive-foreground h-2 w-2 rounded-full" />
    <Text className="text-destructive-foreground font-sans-semibold text-[13px]">
      Recording ·
    </Text>
    <ElapsedTimer
      seconds={recording.elapsedSeconds}
      since={since}
      limit={
        recording.endsInSeconds != null
          ? recording.elapsedSeconds + recording.endsInSeconds
          : undefined
      }
      className="text-destructive-foreground text-[13px]"
    />
  </View>
);

/** One big tappable court — read from a step away, hit with a thumb. */
const CourtCard = ({ court, since, onPress }) => {
  const colors = useThemeColors();
  const state = pairedCourtState(court);
  return (
    <Pressable
      onPress={() => onPress(court)}
      accessibilityRole="button"
      accessibilityLabel={`${court.name}, ${state.label}`}
      className={cn(
        "bg-card min-h-[96px] flex-row items-center gap-4 rounded-[18px] border px-5 py-5 active:bg-secondary/60",
        court.recording ? "border-destructive" : "border-border",
      )}
    >
      <View className="min-w-0 flex-1 gap-2">
        <Text className="font-sans-semibold text-[24px]" numberOfLines={1}>
          {court.name}
        </Text>
        {court.recording ? (
          <RecordingBadge recording={court.recording} since={since} />
        ) : (
          <StatusChip label={state.label} tone={state.tone} />
        )}
      </View>
      <ChevronRight size={26} color={colors.mutedForeground} />
    </Pressable>
  );
};

/**
 * Paired mode home — the venue's courts as big cards with whether each can
 * record right now, and a ticking red badge on any court recording a whole
 * game. Tap one to Start / End recording or save the last 60 s. The header carries the venue name,
 * Take payment, and "This phone" (settings / unpair).
 */
const PairedCourtsScreen = () => {
  const colors = useThemeColors();
  const navigation = useNavigation();
  const m = usePairedCourts();

  const openCourt = (court) =>
    navigation.navigate(SCREEN_NAVIGATION.Paired.Court, {
      courtId: court.courtId,
      courtName: court.name,
    });

  const header = (
    <View className="flex-row items-center gap-1">
      <Pressable
        onPress={() => navigation.navigate(SCREEN_NAVIGATION.Paired.TakePayment)}
        accessibilityRole="button"
        accessibilityLabel="Take payment"
        hitSlop={6}
        className="border-border h-11 flex-row items-center gap-1.5 rounded-lg border px-3 active:bg-secondary"
      >
        <Banknote size={18} color={colors.foreground} />
        <Text className="font-sans-medium text-[13.5px]">Take payment</Text>
      </Pressable>
      <Pressable
        onPress={m.openSettings}
        accessibilityRole="button"
        accessibilityLabel="This phone"
        hitSlop={6}
        className="h-11 w-11 items-center justify-center rounded-lg active:bg-secondary"
      >
        <Settings2 size={20} color={colors.foreground} />
      </Pressable>
    </View>
  );

  const empty = m.isLoading ? (
    <View className="items-center py-20">
      <DotsLoader color={colors.mutedForeground} />
    </View>
  ) : m.error && !isConnectionError(m.error) ? (
    <QueryState
      title="Couldn't load the courts"
      message={m.error?.response?.data?.message}
      onRetry={m.refresh}
    />
  ) : m.hasData ? (
    <EmptyState
      icon={MapPin}
      title="No courts yet"
      message="This venue has no active courts. A manager adds them in the Admin portal."
    />
  ) : null;

  return (
    <View className="bg-background flex-1">
      <ScreenHeader title={m.venueName} right={header} />

      <FlatList
        data={m.courts}
        keyExtractor={(c) => c.courtId}
        renderItem={({ item }) => (
          <CourtCard court={item} since={m.recordingSince} onPress={openCourt} />
        )}
        ItemSeparatorComponent={() => <View className="h-3" />}
        ListHeaderComponent={
          <ConnectionBanner error={m.error} className="mb-4" />
        }
        ListEmptyComponent={empty}
        contentContainerClassName="w-full max-w-[720px] self-center p-4 pb-10"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={m.isRefreshing} onRefresh={m.refresh} />
        }
      />

      <PairedSettingsSheet
        open={m.settingsOpen}
        onClose={m.closeSettings}
        phoneName={m.phoneName}
        venueName={m.venueName}
        onUnpair={m.unpair}
      />
    </View>
  );
};

export default PairedCourtsScreen;
