import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { SCREEN_NAVIGATION } from "../constants/navigations";
import EndedScreen from "../Screens/Device/Ended";
import PairScreen from "../Screens/Device/Pair";
import SessionScreen from "../Screens/Device/Session";
import { SESSION_KEY, useGetDeviceSession } from "../services/requests/session";
import { usePairedStore } from "../store/usePairedStore";

const Stack = createNativeStackNavigator();

/**
 * The courtside session device's three states (PLAN-002 Phase E), each its
 * own navigator. The whole navigator is swapped rather than a screen pushed,
 * so an unpaired device can't be navigated back into a session.
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
 */
const DeviceNavigator = () => {
  const token = usePairedStore((s) => s.token);
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

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {!token ? (
        <Stack.Screen name={SCREEN_NAVIGATION.Pair} component={PairScreen} />
      ) : ended ? (
        <Stack.Screen name={SCREEN_NAVIGATION.Ended} component={EndedScreen} />
      ) : (
        <Stack.Screen name={SCREEN_NAVIGATION.Session} component={SessionScreen} />
      )}
    </Stack.Navigator>
  );
};

export default DeviceNavigator;
