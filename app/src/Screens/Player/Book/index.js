import { Clock, LocateFixed, MapPin, Navigation } from "lucide-react-native";
import { FlatList, RefreshControl, View } from "react-native";
import DotsLoader from "@/components/Loading/DotsLoader";
import { EmptyState, InitialAvatar } from "@/components/pattern";
import QueryState from "@/components/QueryState";
import ScreenHeader from "@/components/ScreenHeader";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useThemeColors } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import { formatHours } from "@/utils/dynaCam";
import { formatDistance } from "@/utils/geo";
import { useBookScreen } from "./useBookScreen";

/** One venue: name, address, today's hours, courts, distance; Book and Directions. */
const VenueCard = ({ venue, onBook, onDirections }) => {
  const colors = useThemeColors();
  return (
    <View className="border-border bg-card mb-3 rounded-2xl border p-4">
      <View className="flex-row items-start gap-3">
        <InitialAvatar label={venue.name} size={42} />
        <View className="flex-1">
          <Text className="font-sans-semibold text-[16px]" numberOfLines={2}>
            {venue.name}
          </Text>
          {venue.address ? (
            <Text className="text-muted-foreground mt-0.5 text-[13px]" numberOfLines={2}>
              {venue.address}
            </Text>
          ) : null}
        </View>
        {venue.distanceKm != null ? (
          <View className="bg-secondary rounded-full px-2.5 py-1">
            <Text className="font-sans-semibold text-[12px]">{formatDistance(venue.distanceKm)}</Text>
          </View>
        ) : null}
      </View>

      <View className="mt-3 flex-row flex-wrap items-center gap-x-4 gap-y-1">
        <View className="flex-row items-center gap-1.5">
          <Clock size={14} color={colors.mutedForeground} />
          <Text className="text-muted-foreground text-[13px]">
            {venue.todayHours ? `Today · ${formatHours(venue.todayHours)}` : "Closed today"}
          </Text>
        </View>
        <Text className="text-muted-foreground text-[13px]">
          {venue.courtCount} {venue.courtCount === 1 ? "court" : "courts"}
        </Text>
      </View>

      <View className="mt-4 flex-row gap-2">
        <Button onPress={() => onBook(venue)} className="h-11 flex-1">
          <Text className="text-primary-foreground font-sans-semibold text-[14.5px]">Book</Text>
        </Button>
        {venue.directionsUrl ? (
          <Button
            variant="outline"
            onPress={() => onDirections(venue)}
            className="h-11 flex-row gap-1.5 px-4"
            accessibilityLabel={`Directions to ${venue.name}`}
          >
            <Navigation size={15} color={colors.foreground} />
            <Text className="font-sans-semibold text-[14.5px]">Directions</Text>
          </Button>
        ) : null}
      </View>
    </View>
  );
};

/**
 * PLAN-009 Book tab: every venue that takes online bookings (GET
 * /public/venues), with Near me. Book opens the venue's booking page for now
 * (native booking is slice A2).
 */
const BookScreen = () => {
  const colors = useThemeColors();
  const m = useBookScreen();

  const nearMeButton = (
    <Button
      variant={m.nearMe ? "default" : "outline"}
      size="sm"
      onPress={m.toggleNearMe}
      disabled={m.locating}
      className="h-9 flex-row gap-1.5 px-3"
      accessibilityState={{ selected: m.nearMe, busy: m.locating }}
    >
      {m.locating ? (
        <DotsLoader color={m.nearMe ? colors.primaryForeground : colors.foreground} />
      ) : (
        <LocateFixed size={15} color={m.nearMe ? colors.primaryForeground : colors.foreground} />
      )}
      <Text
        className={cn(
          "font-sans-semibold text-[13px]",
          m.nearMe ? "text-primary-foreground" : null,
        )}
      >
        Near me
      </Text>
    </Button>
  );

  return (
    <View className="bg-background flex-1">
      <ScreenHeader title="Book a court" right={nearMeButton} />
      {m.isLoading || (m.isError && !m.venues.length) ? (
        <QueryState
          loading={m.isLoading}
          title="Couldn't load the venues"
          message={m.errorMessage}
          onRetry={m.refresh}
        />
      ) : (
        <FlatList
          data={m.venues}
          keyExtractor={(v) => v.bookingToken}
          contentContainerClassName="p-4"
          renderItem={({ item }) => (
            <VenueCard venue={item} onBook={m.book} onDirections={m.directions} />
          )}
          ListHeaderComponent={
            m.locationError ? (
              <View className="border-border bg-secondary mb-3 flex-row items-start gap-2.5 rounded-xl border p-3">
                <MapPin size={16} color={colors.foreground} />
                <Text className="flex-1 text-[13px]">{m.locationError}</Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon={MapPin}
              title="No venues yet"
              message="Venues that take online bookings will show up here."
            />
          }
          refreshControl={<RefreshControl refreshing={m.refreshing} onRefresh={m.refresh} />}
        />
      )}
    </View>
  );
};

export default BookScreen;
