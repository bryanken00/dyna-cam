import { CalendarPlus, Users } from "lucide-react-native";
import { RefreshControl, ScrollView, View } from "react-native";
import BookingCard from "@/components/BookingCard";
import DotsLoader from "@/components/Loading/DotsLoader";
import { SectionLabel } from "@/components/pattern";
import ScreenHeader from "@/components/ScreenHeader";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { SCREEN_NAVIGATION } from "@/constants/navigations";
import { useThemeColors } from "@/hooks/useTheme";
import { useMyGames } from "@/services/requests/player";
import { usePlayerStore } from "@/store/usePlayerStore";

/**
 * PLAN-009 Home: a greeting, the player's next bookings, and the way in to
 * booking. Open plays near me and the followed venues' posts join it in
 * phases B and C.
 */
const HomeScreen = ({ navigation }) => {
  const colors = useThemeColors();
  const firstName = usePlayerStore((s) => s.player?.firstName);
  const games = useMyGames();
  const upcoming = games.data?.data?.upcoming || [];

  return (
    <View className="bg-background flex-1">
      <ScreenHeader title="DGSports" />
      <ScrollView
        contentContainerClassName="p-4"
        refreshControl={
          <RefreshControl refreshing={games.isRefetching} onRefresh={games.refetch} />
        }
      >
        <Text className="font-sans-bold text-[24px] tracking-tight">
          {firstName ? `Hi, ${firstName}` : "Hi there"}
        </Text>
        <Text className="text-muted-foreground mt-1 text-[14px]">Ready to play?</Text>

        <View className="bg-brand mt-5 rounded-2xl p-5">
          <Text className="font-sans-bold text-[18px] text-white">Book a court</Text>
          <Text className="mt-1 text-[13.5px] text-white/75">
            Pick a venue near you, tap your hours and pay online.
          </Text>
          <Button
            variant="secondary"
            onPress={() => navigation.navigate(SCREEN_NAVIGATION.Book)}
            className="mt-4 h-11 flex-row gap-2 self-start px-4"
          >
            <CalendarPlus size={16} color={colors.foreground} />
            <Text className="font-sans-semibold text-[14.5px]">Find a court</Text>
          </Button>
        </View>

        <SectionLabel className="mt-6">Your next games</SectionLabel>
        {games.isLoading ? (
          <View className="items-center py-8">
            <DotsLoader color={colors.mutedForeground} />
          </View>
        ) : upcoming.length ? (
          upcoming.slice(0, 3).map((b) => (
            <BookingCard key={b.bookingCode} booking={b} className="mb-3" />
          ))
        ) : (
          <View className="border-border bg-card rounded-2xl border p-4">
            <Text className="text-muted-foreground text-[13.5px]">
              {games.isError
                ? "Couldn't load your bookings — pull down to try again."
                : "No upcoming bookings. Book a court and it shows up here."}
            </Text>
          </View>
        )}

        <View className="border-border bg-card mt-6 flex-row items-center gap-3 rounded-2xl border p-4">
          <View className="border-border bg-secondary h-10 w-10 items-center justify-center rounded-xl border">
            <Users size={18} color={colors.foreground} />
          </View>
          <View className="flex-1">
            <Text className="font-sans-semibold text-[15px]">Open plays are coming</Text>
            <Text className="text-muted-foreground mt-0.5 text-[13px]">
              Join a game at a venue near you, no full group needed.
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
};

export default HomeScreen;
