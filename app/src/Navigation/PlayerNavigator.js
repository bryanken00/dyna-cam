import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { CalendarPlus, House, UserRound, Users, UsersRound } from "lucide-react-native";
import { SCREEN_NAVIGATION } from "../constants/navigations";
import { useThemeColors } from "../hooks/useTheme";
import BookScreen from "../Screens/Player/Book";
import CommunitiesScreen from "../Screens/Player/Communities";
import CompleteProfileScreen from "../Screens/Player/CompleteProfile";
import HomeScreen from "../Screens/Player/Home";
import MeScreen from "../Screens/Player/Me";
import OpenPlaysScreen from "../Screens/Player/OpenPlays";
import SignInScreen from "../Screens/Player/SignIn";
import { usePlayerMe } from "../services/requests/player";
import { usePlayerStore } from "../store/usePlayerStore";

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const TAB_ICONS = {
  [SCREEN_NAVIGATION.Home]: House,
  [SCREEN_NAVIGATION.Book]: CalendarPlus,
  [SCREEN_NAVIGATION.OpenPlays]: Users,
  [SCREEN_NAVIGATION.Communities]: UsersRound,
  [SCREEN_NAVIGATION.Me]: UserRound,
};

const TAB_LABELS = {
  [SCREEN_NAVIGATION.Home]: "Home",
  [SCREEN_NAVIGATION.Book]: "Book",
  [SCREEN_NAVIGATION.OpenPlays]: "Open plays",
  [SCREEN_NAVIGATION.Communities]: "Communities",
  [SCREEN_NAVIGATION.Me]: "Me",
};

/** The signed-in player's tabs (PLAN-009). Each screen draws its own ScreenHeader. */
const PlayerTabs = () => {
  const colors = useThemeColors();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => {
        const Icon = TAB_ICONS[route.name];
        return {
          headerShown: false,
          tabBarLabel: TAB_LABELS[route.name],
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.mutedForeground,
          tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
          tabBarLabelStyle: { fontFamily: "Onest_500Medium", fontSize: 11 },
          tabBarIcon: ({ color, size }) => <Icon size={size - 2} color={color} />,
        };
      }}
    >
      <Tab.Screen name={SCREEN_NAVIGATION.Home} component={HomeScreen} />
      <Tab.Screen name={SCREEN_NAVIGATION.Book} component={BookScreen} />
      <Tab.Screen name={SCREEN_NAVIGATION.OpenPlays} component={OpenPlaysScreen} />
      <Tab.Screen name={SCREEN_NAVIGATION.Communities} component={CommunitiesScreen} />
      <Tab.Screen name={SCREEN_NAVIGATION.Me} component={MeScreen} />
    </Tab.Navigator>
  );
};

/**
 * The player app (PLAN-009), switched on the player's sign-in like the device
 * mode is on its pairing — nothing navigates between these by hand:
 *
 *   • signed out                      → Sign in (Continue with Google)
 *   • signed in, profile not complete → Complete your profile (PLAN-006: booking needs it)
 *   • signed in                       → the tabs, plus Edit profile pushed from Me
 *
 * usePlayerMe refreshes the profile on every launch (the store keeps the last
 * one, so an offline launch still opens on the tabs).
 */
const PlayerNavigator = () => {
  const signedIn = usePlayerStore((s) => Boolean(s.accessToken));
  const profileComplete = usePlayerStore((s) => s.player?.profileComplete !== false);
  usePlayerMe();

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {!signedIn ? (
        <Stack.Screen name={SCREEN_NAVIGATION.SignIn} component={SignInScreen} />
      ) : !profileComplete ? (
        <Stack.Screen name={SCREEN_NAVIGATION.CompleteProfile} component={CompleteProfileScreen} />
      ) : (
        <>
          <Stack.Screen name={SCREEN_NAVIGATION.PlayerTabs} component={PlayerTabs} />
          <Stack.Screen name={SCREEN_NAVIGATION.EditProfile} component={CompleteProfileScreen} />
        </>
      )}
    </Stack.Navigator>
  );
};

export default PlayerNavigator;
