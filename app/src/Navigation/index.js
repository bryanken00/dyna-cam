import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { SCREEN_NAVIGATION } from "../constants/navigations";
import { NAV_THEME } from "../lib/theme";
import ChangePassword from "../Screens/Account/ChangePassword";
import ClipsScreen from "../Screens/Clips";
import ClipDetailScreen from "../Screens/Clips/ClipDetail";
import CourtsScreen from "../Screens/Courts";
import CourtDetailScreen from "../Screens/Courts/CourtDetail";
import Home from "../Screens/Home";
import Login from "../Screens/Login/Index";
import PairScreen from "../Screens/Pair";
import PairedCourtScreen from "../Screens/Paired/Court";
import PairedCourtsScreen from "../Screens/Paired/Courts";
import ShareQrScreen from "../Screens/Paired/ShareQr";
import PairedTakePaymentScreen from "../Screens/Paired/TakePayment";
import RecorderBoxesScreen from "../Screens/RecorderBoxes";
import SessionsScreen from "../Screens/Sessions";
import SessionDetailScreen from "../Screens/Sessions/SessionDetail";
import TakePaymentScreen from "../Screens/TakePayment";
import { usePairedStore } from "../store/usePairedStore";
import useThemeStore from "../store/useThemeStore";
import { useUserAuthStore } from "../store/useUserAuthStore";

export const Stack = createNativeStackNavigator();

/**
 * Four stacks, switched on who is using the phone. The whole navigator is
 * swapped rather than a screen pushed, so signing out or unpairing cannot be
 * navigated back into.
 *
 *   • staff account, temporary password  → ChangePassword only (the API
 *     refuses everything else with 403 PASSWORD_CHANGE_REQUIRED, and the axios
 *     interceptor sets the flag if it is raised mid-session)
 *   • staff account signed in             → the full app (Home tabs + modules)
 *   • phone paired to a venue (PLAN-002)  → paired mode: Courts → Court →
 *     Share QR, plus Take payment
 *   • neither                             → "Pair this phone", with Login one
 *     tap away ("Sign in with a staff account instead")
 *
 * A staff sign-in wins over a pairing: it only happens when someone chose it
 * on purpose, and signing out falls back to the phone's paired mode.
 *
 * Nothing renders until the pairing has been read from the secure store
 * (App.js keeps the splash up meanwhile), so a paired phone never flashes the
 * Pair screen on launch.
 *
 * To add a screen:
 *   1. Add its name to SCREEN_NAVIGATION in constants/navigations.js
 *   2. Import the component here
 *   3. Register it in the right stack:
 *
 *      <Stack.Screen
 *        name={SCREEN_NAVIGATION.Profile}
 *        component={Profile}
 *      />
 *
 * Navigate with the constant, never a string literal:
 *   navigation.navigate(SCREEN_NAVIGATION.Profile)
 */
const Navigation = () => {
  const isAuthenticated = useUserAuthStore((s) => s.isAuthenticated);
  const mustChangePassword = useUserAuthStore((s) =>
    Boolean(s.user?.mustChangePassword),
  );
  const pairedToken = usePairedStore((s) => s.token);
  const pairedHydrated = usePairedStore((s) => s.hydrated);
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const queryClient = useQueryClient();

  // A new pairing (or none) must never see the last one's cached courts and
  // clips — drop every "paired" query whenever the token changes.
  const lastToken = useRef(pairedToken);
  useEffect(() => {
    if (lastToken.current !== pairedToken) {
      queryClient.removeQueries({ queryKey: ["paired"] });
      lastToken.current = pairedToken;
    }
  }, [pairedToken, queryClient]);

  if (!pairedHydrated) return null;

  return (
    <NavigationContainer theme={isDarkMode ? NAV_THEME.dark : NAV_THEME.light}>
      {isAuthenticated && mustChangePassword ? (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen
            name={SCREEN_NAVIGATION.Account.ChangePassword}
            component={ChangePassword}
          />
        </Stack.Navigator>
      ) : isAuthenticated ? (
        <Stack.Navigator
          initialRouteName={SCREEN_NAVIGATION.Home}
          screenOptions={{ headerShown: false }}
        >
          <Stack.Screen name={SCREEN_NAVIGATION.Home} component={Home} />
          <Stack.Screen
            name={SCREEN_NAVIGATION.Account.ChangePassword}
            component={ChangePassword}
          />

          {/* Modules — opened from the Menu tab (and the Dashboard). Each
              screen gates its own write actions on the user's permissions;
              the Menu only lists the ones the user may read. */}
          <Stack.Screen
            name={SCREEN_NAVIGATION.Modules.Courts}
            component={CourtsScreen}
          />
          <Stack.Screen
            name={SCREEN_NAVIGATION.Modules.CourtDetail}
            component={CourtDetailScreen}
          />
          <Stack.Screen
            name={SCREEN_NAVIGATION.Modules.Clips}
            component={ClipsScreen}
          />
          <Stack.Screen
            name={SCREEN_NAVIGATION.Modules.ClipDetail}
            component={ClipDetailScreen}
          />
          <Stack.Screen
            name={SCREEN_NAVIGATION.Modules.Sessions}
            component={SessionsScreen}
          />
          <Stack.Screen
            name={SCREEN_NAVIGATION.Modules.SessionDetail}
            component={SessionDetailScreen}
          />
          <Stack.Screen
            name={SCREEN_NAVIGATION.Modules.TakePayment}
            component={TakePaymentScreen}
          />
          <Stack.Screen
            name={SCREEN_NAVIGATION.Modules.RecorderBoxes}
            component={RecorderBoxesScreen}
          />
        </Stack.Navigator>
      ) : pairedToken ? (
        <Stack.Navigator
          initialRouteName={SCREEN_NAVIGATION.Paired.Courts}
          screenOptions={{ headerShown: false }}
        >
          <Stack.Screen
            name={SCREEN_NAVIGATION.Paired.Courts}
            component={PairedCourtsScreen}
          />
          <Stack.Screen
            name={SCREEN_NAVIGATION.Paired.Court}
            component={PairedCourtScreen}
          />
          <Stack.Screen
            name={SCREEN_NAVIGATION.Paired.ShareQr}
            component={ShareQrScreen}
          />
          <Stack.Screen
            name={SCREEN_NAVIGATION.Paired.TakePayment}
            component={PairedTakePaymentScreen}
          />
        </Stack.Navigator>
      ) : (
        <Stack.Navigator
          initialRouteName={SCREEN_NAVIGATION.Pair}
          screenOptions={{ headerShown: false }}
        >
          <Stack.Screen name={SCREEN_NAVIGATION.Pair} component={PairScreen} />
          <Stack.Screen name={SCREEN_NAVIGATION.Login} component={Login} />
        </Stack.Navigator>
      )}
    </NavigationContainer>
  );
};

export default Navigation;
