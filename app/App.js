import "./global.css";

import { PortalHost } from "@rn-primitives/portal";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { colorScheme } from "nativewind";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";
import Toast from "react-native-toast-message";
import Navigation from "./src/Navigation";
import { CustomDialogProvider } from "./src/hooks/useCustomDialog";
import { useAppFonts } from "./src/hooks/useAppFonts";
import { initDatabase } from "./src/store/database/initDatabase";
import { useAppModeStore } from "./src/store/useAppModeStore";
import { usePairedStore } from "./src/store/usePairedStore";
import { usePlayerStore } from "./src/store/usePlayerStore";
import useThemeStore from "./src/store/useThemeStore";

/**
 * App-wide React Query defaults (engineering-checklist §2):
 *  • retry only what can succeed by being repeated — no response (offline,
 *    timeout) or a 5xx. A 4xx (404 pay code, 403 permission, 409 conflict)
 *    is final, and retrying it just delays the error on screen.
 *  • a short staleTime, so moving between a list and its detail doesn't
 *    refetch everything on every mount. Lists still refresh on pull, on the
 *    refresh button, and after every write (mutations invalidate).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15 * 1000,
      retry: (failureCount, error) => {
        const status = error?.response?.status;
        if (status && status < 500) return false;
        return failureCount < 2;
      },
    },
  },
});

// Keep the native splash up until fonts are ready, so the first painted frame
// is already in Onest rather than the system font.
SplashScreen.preventAutoHideAsync().catch(() => {
  /* no-op — already hidden, or called twice on fast refresh */
});

/** PLAN-009: the stores read from the secure store at launch. */
const SECURE_STORES = [useAppModeStore, usePairedStore, usePlayerStore];

const AppContent = () => {
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const [fontsLoaded, fontError] = useAppFonts();

  // Tailwind config uses darkMode:"class", so NativeWind needs to be told which
  // scheme is active. This is what makes every `dark:` class in the app follow
  // the in-app toggle rather than the device setting.
  useEffect(() => {
    colorScheme.set(isDarkMode ? "dark" : "light");
  }, [isDarkMode]);

  // Create local SQLite tables, run migrations, add indexes.
  // Remove this if your app has no offline storage.
  useEffect(() => {
    initDatabase();
  }, []);

  // The app mode, the device's pairing and the player's sign-in are read from
  // the secure store asynchronously (PLAN-009). Hold the splash until they
  // have been, so the app opens straight on the right screen instead of
  // flashing Welcome. If the store never answers, give up after a few seconds
  // rather than hang on the splash.
  const modeHydrated = useAppModeStore((s) => s.hydrated);
  const pairedHydrated = usePairedStore((s) => s.hydrated);
  const playerHydrated = usePlayerStore((s) => s.hydrated);
  const storesHydrated = modeHydrated && pairedHydrated && playerHydrated;
  useEffect(() => {
    const id = setTimeout(() => {
      SECURE_STORES.forEach((store) => {
        if (!store.getState().hydrated) store.setState({ hydrated: true });
      });
    }, 4000);
    return () => clearTimeout(id);
  }, []);

  // Drop the splash once fonts settle. `fontError` is included deliberately:
  // if a font fails we still show the app in a fallback face rather than
  // hanging on the splash forever.
  useEffect(() => {
    if ((fontsLoaded || fontError) && storesHydrated) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, fontError, storesHydrated]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <React.Fragment>
      <StatusBar style={isDarkMode ? "light" : "dark"} />
      <SafeAreaView className="flex-1 bg-background">
        <GestureHandlerRootView className="flex-1">
          {/* CustomDialogProvider must stay mounted — useCustomDialog reads its context */}
          <CustomDialogProvider>
            <Navigation />
            <Toast />
          </CustomDialogProvider>
        </GestureHandlerRootView>
      </SafeAreaView>
      {/* PortalHost renders overlays (dialogs, popovers, selects) above
          everything else. It must be the last child of the providers. */}
      <PortalHost />
    </React.Fragment>
  );
};

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}
