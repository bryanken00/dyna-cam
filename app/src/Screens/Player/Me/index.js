import { Image } from "expo-image";
import { ChevronRight, LogOut, Pencil, Smartphone } from "lucide-react-native";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import BookingCard from "@/components/BookingCard";
import DotsLoader from "@/components/Loading/DotsLoader";
import { InitialAvatar, SectionLabel } from "@/components/pattern";
import ScreenHeader from "@/components/ScreenHeader";
import { Text } from "@/components/ui/text";
import { SCREEN_NAVIGATION } from "@/constants/navigations";
import { VERSION } from "@/constants/version";
import { useThemeColors } from "@/hooks/useTheme";
import { formatPhoneDisplay } from "@/utils/phoneFormat";
import { useMeScreen } from "./useMeScreen";

const SettingsRow = ({ Icon, label, onPress, destructive, disabled }) => {
  const colors = useThemeColors();
  const tint = destructive ? colors.destructive : colors.foreground;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      className="flex-row items-center gap-3 px-4 py-3.5 active:bg-secondary"
    >
      <Icon size={18} color={tint} />
      <Text className={destructive ? "text-destructive flex-1 text-[15px]" : "flex-1 text-[15px]"}>
        {label}
      </Text>
      <ChevronRight size={16} color={colors.mutedForeground} />
    </Pressable>
  );
};

/**
 * PLAN-009 Me: the profile (Edit profile), My games — upcoming bookings and
 * past ones, each with its game videos on Google Drive — then settings.
 */
const MeScreen = ({ navigation }) => {
  const colors = useThemeColors();
  const m = useMeScreen();
  const p = m.player;

  return (
    <View className="bg-background flex-1">
      <ScreenHeader title="Me" />
      <ScrollView
        contentContainerClassName="p-4"
        refreshControl={<RefreshControl refreshing={m.refreshing} onRefresh={m.refresh} />}
      >
        <View className="border-border bg-card flex-row items-center gap-3.5 rounded-2xl border p-4">
          {p?.photoUrl ? (
            <Image
              source={{ uri: p.photoUrl }}
              style={{ width: 52, height: 52, borderRadius: 14 }}
              accessibilityLabel="Your photo"
            />
          ) : (
            <InitialAvatar label={p?.name} size={52} />
          )}
          <View className="flex-1">
            <Text className="font-sans-semibold text-[17px]" numberOfLines={1}>
              {p?.name || "Player"}
            </Text>
            <Text className="text-muted-foreground text-[13px]" numberOfLines={1}>
              {p?.email}
            </Text>
            {p?.phone ? (
              <Text className="text-muted-foreground text-[13px]">{formatPhoneDisplay(p.phone)}</Text>
            ) : null}
          </View>
          <Pressable
            onPress={() => navigation.navigate(SCREEN_NAVIGATION.EditProfile)}
            accessibilityLabel="Edit profile"
            hitSlop={8}
            className="border-border h-9 w-9 items-center justify-center rounded-lg border active:bg-secondary"
          >
            <Pencil size={16} color={colors.foreground} />
          </Pressable>
        </View>

        <SectionLabel className="mt-6">Upcoming</SectionLabel>
        {m.gamesLoading ? (
          <View className="items-center py-6">
            <DotsLoader color={colors.mutedForeground} />
          </View>
        ) : m.upcoming.length ? (
          m.upcoming.map((b) => <BookingCard key={b.bookingCode} booking={b} className="mb-3" />)
        ) : (
          <Text className="text-muted-foreground mb-2 text-[13.5px]">
            {m.gamesError ? "Couldn't load your games — pull down to try again." : "No upcoming bookings."}
          </Text>
        )}

        <SectionLabel className="mt-4">My games</SectionLabel>
        {!m.gamesLoading && !m.past.length ? (
          <Text className="text-muted-foreground mb-2 text-[13.5px]">
            Your past games and their videos show up here.
          </Text>
        ) : null}
        {m.past.map((b) => (
          <BookingCard key={b.bookingCode} booking={b} className="mb-3" />
        ))}

        <View className="border-border bg-card mt-4 overflow-hidden rounded-2xl border">
          <SettingsRow
            Icon={Smartphone}
            label="Use as a courtside device"
            onPress={m.confirmDeviceMode}
          />
          <View className="bg-border h-px" />
          <SettingsRow
            Icon={LogOut}
            label="Sign out"
            destructive
            disabled={m.signingOut}
            onPress={m.confirmSignOut}
          />
        </View>

        <Text className="text-muted-foreground mt-5 text-center text-[12px]">DGSports {VERSION}</Text>
      </ScrollView>
    </View>
  );
};

export default MeScreen;
