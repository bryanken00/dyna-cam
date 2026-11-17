import { useNavigation } from "@react-navigation/native";
import { AlertTriangle, Film } from "lucide-react-native";
import { View } from "react-native";
import ChoiceChips from "@/components/ChoiceChips";
import DotsLoader from "@/components/Loading/DotsLoader";
import ScreenHeader from "@/components/ScreenHeader";
import {
  DataList,
  EmptyState,
  FilterBar,
  ListFooter,
} from "@/components/pattern";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { SCREEN_NAVIGATION } from "@/constants/navigations";
import { useThemeColors } from "@/hooks/useTheme";
import ClipRow from "./ClipRow";
import { useClipsModule } from "./useClipsModule";

const STATUS_OPTIONS = [
  { value: null, label: "Any status" },
  { value: "Ready", label: "Ready" },
  { value: "Processing", label: "Processing" },
  { value: "Pending", label: "Pending" },
  { value: "Failed", label: "Failed" },
  { value: "Expired", label: "Expired" },
];

const PAYMENT_OPTIONS = [
  { value: null, label: "Any payment" },
  { value: "Unpaid", label: "Unpaid" },
  { value: "Paid", label: "Paid" },
  { value: "Free", label: "Free" },
];

/** A small caption above each chip row in the filter panel. */
const FilterLabel = ({ children }) => (
  <Text className="text-muted-foreground font-sans-medium mb-1.5 text-[11.5px] uppercase tracking-[0.06em]">
    {children}
  </Text>
);

/**
 * Clips — recent replays, newest first, with a thumbnail, the court and time,
 * and source / status / payment chips. Tap one to play, share or take its
 * payment. Layout only: state lives in useClipsModule.
 *
 * No Fab: clips are made from a court ("Save clip now"), not from here.
 */
const ClipsScreen = () => {
  const colors = useThemeColors();
  const navigation = useNavigation();
  const m = useClipsModule();

  const openClip = (clip) =>
    navigation.navigate(SCREEN_NAVIGATION.Modules.ClipDetail, {
      clipId: clip.clipId,
    });

  const emptySlot = m.isLoading ? (
    <View className="items-center py-14">
      <DotsLoader color={colors.mutedForeground} />
    </View>
  ) : m.isError ? (
    <EmptyState
      icon={AlertTriangle}
      title="Couldn't load clips"
      message="Check your connection and try again."
      action={
        <Button variant="outline" onPress={m.refresh}>
          <Text>Try again</Text>
        </Button>
      }
    />
  ) : (
    <EmptyState
      icon={Film}
      title="No clips found"
      message={
        m.hasActiveFilters
          ? "Try clearing your filters."
          : "Clips appear here when a player scans a court's QR or presses its button."
      }
    />
  );

  return (
    <View className="bg-background flex-1">
      <ScreenHeader title="Clips" onBack={navigation.goBack} />

      <DataList
        data={m.pageItems}
        keyExtractor={(item) => item.clipId}
        onRefresh={m.refresh}
        refreshing={m.isRefreshing}
        renderItem={({ item }) => <ClipRow clip={item} onPress={openClip} />}
        toolbar={
          <FilterBar
            title="Newest first"
            onRefresh={m.refresh}
            refreshing={m.isRefreshing}
            onToggleFilters={() => m.setShowFilters(!m.showFilters)}
            filtersActive={m.showFilters || m.hasActiveFilters}
          >
            {m.showFilters ? (
              <View className="gap-3">
                {m.venues.length > 1 ? (
                  <View>
                    <FilterLabel>Venue</FilterLabel>
                    <ChoiceChips
                      value={m.venueId}
                      onChange={m.setVenueId}
                      options={[
                        { value: null, label: "All venues" },
                        ...m.venues.map((v) => ({ value: v.venueId, label: v.name })),
                      ]}
                    />
                  </View>
                ) : null}
                <View>
                  <FilterLabel>Court</FilterLabel>
                  <ChoiceChips
                    value={m.courtId}
                    onChange={m.setCourtId}
                    options={[
                      { value: null, label: "All courts" },
                      ...m.courts.map((c) => ({
                        value: c.courtId,
                        label: m.venueId ? c.name : `${c.name} · ${c.venueName}`,
                      })),
                    ]}
                  />
                </View>
                <View>
                  <FilterLabel>Status</FilterLabel>
                  <ChoiceChips
                    value={m.status}
                    onChange={m.setStatus}
                    options={STATUS_OPTIONS}
                  />
                </View>
                <View>
                  <FilterLabel>Payment</FilterLabel>
                  <ChoiceChips
                    value={m.paymentStatus}
                    onChange={m.setPaymentStatus}
                    options={PAYMENT_OPTIONS}
                  />
                </View>
                {m.hasActiveFilters ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onPress={m.clearFilters}
                    className="self-end"
                  >
                    <Text className="text-muted-foreground text-[12.5px]">
                      Clear all
                    </Text>
                  </Button>
                ) : null}
              </View>
            ) : null}
          </FilterBar>
        }
        empty={emptySlot}
        footer={
          <ListFooter
            page={m.page}
            pageSize={m.pageSize}
            total={m.total}
            noun="clip"
            onChangePage={m.setPage}
          />
        }
      />
    </View>
  );
};

export default ClipsScreen;
