import { useNavigation } from "@react-navigation/native";
import {
  AlertTriangle,
  CheckCircle2,
  MapPin,
  Video,
} from "lucide-react-native";
import { View } from "react-native";
import ChoiceChips from "@/components/ChoiceChips";
import DotsLoader from "@/components/Loading/DotsLoader";
import ScreenHeader from "@/components/ScreenHeader";
import {
  DataList,
  EmptyState,
  FilterBar,
  ListFooter,
  StatCard,
} from "@/components/pattern";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { SCREEN_NAVIGATION } from "@/constants/navigations";
import { useThemeColors } from "@/hooks/useTheme";
import CourtRow from "./CourtRow";
import { useCourtsModule } from "./useCourtsModule";

/**
 * Courts — every court the user can see, venue by venue, with whether it can
 * record right now (camera set up, recorder box online). Tap a court for
 * "Save clip now" and its QR sign. Layout only: state lives in
 * useCourtsModule.
 *
 * No Fab: courts are created in the web portal, not from a phone.
 */
const CourtsScreen = () => {
  const colors = useThemeColors();
  const navigation = useNavigation();
  const m = useCourtsModule();

  const openCourt = (court) =>
    navigation.navigate(SCREEN_NAVIGATION.Modules.CourtDetail, {
      courtId: court.courtId,
      courtName: court.name,
    });

  const emptySlot = m.isLoading ? (
    <View className="items-center py-14">
      <DotsLoader color={colors.mutedForeground} />
    </View>
  ) : m.isError ? (
    <EmptyState
      icon={AlertTriangle}
      title="Couldn't load courts"
      message="Check your connection and try again."
      action={
        <Button variant="outline" onPress={m.refresh}>
          <Text>Try again</Text>
        </Button>
      }
    />
  ) : (
    <EmptyState
      icon={MapPin}
      title="No courts found"
      message={
        m.search || m.hasActiveFilters
          ? "Try a different search or clear your filters."
          : "Courts are added in the web portal, under Venues."
      }
    />
  );

  return (
    <View className="bg-background flex-1">
      <ScreenHeader title="Courts" onBack={navigation.goBack} />

      <DataList
        data={m.pageItems}
        keyExtractor={(item) => item.courtId}
        onRefresh={m.refresh}
        refreshing={m.isRefreshing}
        renderItem={({ item }) => <CourtRow court={item} onPress={openCourt} />}
        ListHeaderComponent={
          m.stats ? (
            <View className="flex-row flex-wrap gap-3 pb-5">
              <StatCard
                title="Courts"
                value={m.stats.total}
                change={m.hasActiveFilters ? "in this venue" : "all venues"}
                icon={MapPin}
                className="min-w-[45%] flex-1"
              />
              <StatCard
                title="Recording"
                value={m.stats.ready}
                change="camera + box online"
                icon={CheckCircle2}
                className="min-w-[45%] flex-1"
              />
              <StatCard
                title="Need attention"
                value={m.stats.attention}
                change="offline, no camera or inactive"
                icon={Video}
                className="min-w-[45%] flex-1"
              />
            </View>
          ) : null
        }
        toolbar={
          <FilterBar
            value={m.search}
            onChangeText={m.setSearch}
            placeholder="Search courts or venues…"
            onRefresh={m.refresh}
            refreshing={m.isRefreshing}
            onToggleFilters={
              m.venues.length > 1
                ? () => m.setShowFilters(!m.showFilters)
                : undefined
            }
            filtersActive={m.showFilters || m.hasActiveFilters}
          >
            {m.showFilters ? (
              <ChoiceChips
                value={m.venueId}
                onChange={m.setVenueId}
                options={[
                  { value: null, label: "All venues" },
                  ...m.venues.map((v) => ({ value: v.venueId, label: v.name })),
                ]}
              />
            ) : null}
          </FilterBar>
        }
        empty={emptySlot}
        footer={
          <ListFooter
            page={m.page}
            pageSize={m.pageSize}
            total={m.total}
            noun="court"
            onChangePage={m.setPage}
          />
        }
      />
    </View>
  );
};

export default CourtsScreen;
