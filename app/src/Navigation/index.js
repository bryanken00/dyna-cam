import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SCREEN_NAVIGATION } from "../constants/navigations";
import { NAV_THEME } from "../lib/theme";
import ChangePassword from "../Screens/Account/ChangePassword";
import ClipsScreen from "../Screens/Clips";
import ClipDetailScreen from "../Screens/Clips/ClipDetail";
import CourtsScreen from "../Screens/Courts";
import CourtDetailScreen from "../Screens/Courts/CourtDetail";
import Home from "../Screens/Home";
import Login from "../Screens/Login/Index";
import RecorderBoxesScreen from "../Screens/RecorderBoxes";
import SessionsScreen from "../Screens/Sessions";
import SessionDetailScreen from "../Screens/Sessions/SessionDetail";
import TakePaymentScreen from "../Screens/TakePayment";
import useThemeStore from "../store/useThemeStore";
import { useUserAuthStore } from "../store/useUserAuthStore";

export const Stack = createNativeStackNavigator();

/**
 * Three stacks, switched on auth state. The whole navigator is swapped rather
 * than a screen pushed, so logging out cannot be navigated back into.
 *
 *   • signed out                          → Login
 *   • signed in, temporary password       → ChangePassword only (the API
 *     refuses everything else with 403 PASSWORD_CHANGE_REQUIRED, and the axios
 *     interceptor sets the flag if it is raised mid-session)
 *   • signed in                           → the app
 *
 * To add a screen:
 *   1. Add its name to SCREEN_NAVIGATION in constants/navigations.js
 *   2. Import the component here
 *   3. Register it in the authenticated stack:
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
  const isDarkMode = useThemeStore((s) => s.isDarkMode);

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
      ) : (
        <Stack.Navigator initialRouteName={SCREEN_NAVIGATION.Login}>
          <Stack.Screen
            name={SCREEN_NAVIGATION.Login}
            options={{ headerShown: false }}
            component={Login}
          />
        </Stack.Navigator>
      )}
    </NavigationContainer>
  );
};

export default Navigation;
