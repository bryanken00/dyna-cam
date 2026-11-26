import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SCREEN_NAVIGATION } from "../constants/navigations";
import { NAV_THEME } from "../lib/theme";
import WelcomeScreen from "../Screens/Welcome";
import { APP_MODE, useAppModeStore } from "../store/useAppModeStore";
import { usePairedStore } from "../store/usePairedStore";
import { usePlayerStore } from "../store/usePlayerStore";
import useThemeStore from "../store/useThemeStore";
import DeviceNavigator from "./DeviceNavigator";
import PlayerNavigator from "./PlayerNavigator";

const Stack = createNativeStackNavigator();

/**
 * PLAN-009: one DGSports app with two modes, chosen on first launch and
 * remembered (store/useAppModeStore.js). The whole navigator is swapped:
 *
 *   • no mode yet        → Welcome ("I'm a player" / "Set up a courtside device")
 *   • "device"           → DeviceNavigator (Pair → Session → Ended, PLAN-002)
 *   • "player"           → PlayerNavigator (sign in, profile, the tabs)
 *
 * A device paired before PLAN-009 has a pairing but no mode — it stays a
 * courtside device, so an app update never drops a court's tablet onto the
 * player app.
 *
 * Nothing renders until every secure store has been read (App.js keeps the
 * splash up meanwhile), so the app never flashes the wrong mode on launch.
 *
 * Navigate with SCREEN_NAVIGATION constants, never string literals.
 */
const Navigation = () => {
  const mode = useAppModeStore((s) => s.mode);
  const modeHydrated = useAppModeStore((s) => s.hydrated);
  const paired = usePairedStore((s) => Boolean(s.token));
  const pairedHydrated = usePairedStore((s) => s.hydrated);
  const playerHydrated = usePlayerStore((s) => s.hydrated);
  const isDarkMode = useThemeStore((s) => s.isDarkMode);

  if (!modeHydrated || !pairedHydrated || !playerHydrated) return null;

  const current = mode ?? (paired ? APP_MODE.device : null);

  return (
    <NavigationContainer theme={isDarkMode ? NAV_THEME.dark : NAV_THEME.light}>
      {current === APP_MODE.device ? (
        <DeviceNavigator />
      ) : current === APP_MODE.player ? (
        <PlayerNavigator />
      ) : (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name={SCREEN_NAVIGATION.Welcome} component={WelcomeScreen} />
        </Stack.Navigator>
      )}
    </NavigationContainer>
  );
};

export default Navigation;
