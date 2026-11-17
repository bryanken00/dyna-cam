import { useNavigation } from "@react-navigation/native";
import {
  Banknote,
  CalendarClock,
  Film,
  HardDrive,
  KeyRound,
  LogOut,
  MapPin,
  Moon,
  Sun,
} from "lucide-react-native";
import { useMemo } from "react";
import { Alert, RefreshControl, ScrollView, View } from "react-native";
import GroupedList from "@/components/GroupedList";
import ScreenHeader from "@/components/ScreenHeader";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { SCREEN_NAVIGATION } from "@/constants/navigations";
import DotsLoader from "@/components/Loading/DotsLoader";
import usePermissions from "@/hooks/usePermissions";
import useAppTheme from "@/hooks/useTheme";
import { useLogout } from "@/services/requests/auth";

const SettingsTab = () => {
  const navigation = useNavigation();
  const { colors, isDarkMode, toggleTheme } = useAppTheme();
  const { mutate: logout, isPending: loggingOut } = useLogout();
  const perms = usePermissions();
  const { can } = perms;

  const handleLogout = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: () => logout() },
    ]);
  };

  // Modules live here rather than in the tab bar — the tab bar is for
  // top-level destinations only. Add a row per module, register the screen in
  // src/Navigation/index.js, and name the route in constants/navigations.js.
  //
  // Each row shows only if the user may READ what it opens — the same
  // permission the web portal's <ProtectedRoute> and the API's
  // checkPermission() use for that route group. Write actions inside a
  // module (Save clip now, Book, Record cash) are gated there.
  const modules = useMemo(
    () =>
      [
        can("venues", "courts") && {
          title: "Courts",
          description: "Live status, save a clip now, court QR",
          icon: MapPin,
          onPress: () => navigation.navigate(SCREEN_NAVIGATION.Modules.Courts),
        },
        can("clips") && {
          title: "Clips",
          description: "Recent replays — play, share, take payment",
          icon: Film,
          onPress: () => navigation.navigate(SCREEN_NAVIGATION.Modules.Clips),
        },
        can("clips") && {
          title: "Sessions",
          description: "Book, cancel or end a full-game recording",
          icon: CalendarClock,
          onPress: () =>
            navigation.navigate(SCREEN_NAVIGATION.Modules.Sessions),
        },
        can("payments") && {
          title: "Take payment",
          description: "Record cash for a clip by its pay code",
          icon: Banknote,
          onPress: () =>
            navigation.navigate(SCREEN_NAVIGATION.Modules.TakePayment),
        },
        can("venues", "devices") && {
          title: "Recorder boxes",
          description: "Online status and cameras, read-only",
          icon: HardDrive,
          onPress: () =>
            navigation.navigate(SCREEN_NAVIGATION.Modules.RecorderBoxes),
        },
      ].filter(Boolean),
    [can, navigation],
  );

  const sections = useMemo(
    () => [
      {
        title: "Account",
        items: [
          {
            title: "Change Password",
            description: "Signs you out on your other devices",
            icon: KeyRound,
            onPress: () =>
              navigation.navigate(SCREEN_NAVIGATION.Account.ChangePassword),
          },
        ],
      },
      {
        title: "Preferences",
        items: [
          {
            title: "Dark Mode",
            description: `Currently using ${isDarkMode ? "dark" : "light"} theme`,
            icon: isDarkMode ? Moon : Sun,
            right: (
              <Switch checked={isDarkMode} onCheckedChange={toggleTheme} />
            ),
          },
        ],
      },
    ],
    [isDarkMode, toggleTheme, navigation],
  );

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Menu" />

      <ScrollView
        contentContainerClassName="p-4 pb-10"
        showsVerticalScrollIndicator={false}
        refreshControl={
          // Re-reads the user's permissions, e.g. after an admin changed the role
          <RefreshControl
            refreshing={perms.isRefetching}
            onRefresh={perms.refetch}
          />
        }
      >
        {perms.isLoading ? (
          <View className="items-center py-8">
            <DotsLoader color={colors.mutedForeground} />
          </View>
        ) : perms.isError ? (
          <GroupedList
            title="Modules"
            items={[
              {
                title: "Couldn't load your access",
                description: "Tap to try again",
                icon: KeyRound,
                onPress: () => perms.refetch(),
              },
            ]}
          />
        ) : modules.length ? (
          <GroupedList title="Modules" items={modules} />
        ) : null}

        {sections.map((section) => (
          <GroupedList
            key={section.title}
            title={section.title}
            items={section.items}
          />
        ))}

        <Button
          variant="outline"
          onPress={handleLogout}
          disabled={loggingOut}
          className="border-destructive bg-destructive/10 mb-4 mt-2 h-14 flex-row gap-2.5"
        >
          <LogOut size={18} color={colors.destructive} strokeWidth={2} />
          <Text className="text-destructive text-[15px] font-sans-semibold">
            {loggingOut ? "Signing out…" : "Sign Out"}
          </Text>
        </Button>
      </ScrollView>
    </View>
  );
};

export default SettingsTab;
