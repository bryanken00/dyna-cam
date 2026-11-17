import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { SCREEN_NAVIGATION } from "../constants/navigations";
import { NAV_THEME } from "../lib/theme";
import EndedScreen from "../Screens/Ended";
import PairScreen from "../Screens/Pair";
import SessionScreen from "../Screens/Session";
import { SESSION_KEY, useGetDeviceSession } from "../services/requests/session";
import { usePairedStore } from "../store/usePairedStore";
import useThemeStore from "../store/useThemeStore";

export const Stack = createNativeStackNavigator();

/**
 * The session device's three states (PLAN-002 Phase E), each its own
 * navigator. The whole navigator is swapped rather than a screen pushed, so
 * an unpaired device can't be navigated back into a session.
 *
 *   • no pairing token                        → Pair this device
 *   • paired, the session not over            → Session (live, QR, Stop)
 *   • paired, the session over (the API sends
 *     `unpairInSeconds` — its 10-minute grace) → Ended (QR, Done, countdown)
 *
 * The session query is polled here too (it's the same cached query the
 * screens read), so the switch to Ended happens on the first answer that
 * says the session is over — whether it was Stop on this device, its end
 * time, or staff ending it on the web.
 *
 * Nothing renders until the pairing has been read from the secure store
 * (App.js keeps the splash up meanwhile), so a paired device never flashes
 * the Pair screen on launch.
 *
 * Navigate with SCREEN_NAVIGATION constants, never string literals.
 */
const Navigation = () => {
  const token = usePairedStore((s) => s.token);
  const hydrated = usePairedStore((s) => s.hydrated);
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const queryClient = useQueryClient();
  const session = useGetDeviceSession();
  const ended = session.data?.data?.unpairInSeconds != null;

  // A new pairing (or none) must never see the last one's cached session —
  // drop it whenever the token changes.
  const lastToken = useRef(token);
  useEffect(() => {
    if (lastToken.current !== token) {
      queryClient.removeQueries({ queryKey: SESSION_KEY });
      lastToken.current = token;
    }
  }, [token, queryClient]);

  if (!hydrated) return null;

  return (
    <NavigationContainer theme={isDarkMode ? NAV_THEME.dark : NAV_THEME.light}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!token ? (
          <Stack.Screen name={SCREEN_NAVIGATION.Pair} component={PairScreen} />
        ) : ended ? (
          <Stack.Screen name={SCREEN_NAVIGATION.Ended} component={EndedScreen} />
        ) : (
          <Stack.Screen name={SCREEN_NAVIGATION.Session} component={SessionScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default Navigation;
