import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SCREEN_NAVIGATION } from "../constants/navigations";
import { NAV_THEME } from "../lib/theme";
import ChangePassword from "../Screens/Account/ChangePassword";
import ExampleScreen from "../Screens/Example";
import Home from "../Screens/Home";
import Login from "../Screens/Login/Index";
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

          {/* Modules — opened from the Menu tab. Delete with the example. */}
          <Stack.Screen
            name={SCREEN_NAVIGATION.Modules.Items}
            component={ExampleScreen}
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
