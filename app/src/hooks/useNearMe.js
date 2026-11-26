import * as Location from "expo-location";
import { useCallback, useState } from "react";

/**
 * PLAN-009 Near me: the phone's position, asked for only when the player taps
 * Near me (never on launch). The position stays on the phone.
 *
 *   const near = useNearMe();
 *   near.locate();            // asks permission the first time
 *   near.position             // { latitude, longitude } | null
 *   near.error                // a message for the screen | null
 */
export const useNearMe = () => {
  const [position, setPosition] = useState(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState(null);

  const locate = useCallback(async () => {
    setLocating(true);
    setError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setError("Allow location for DGSports in your phone's settings to see venues near you.");
        return;
      }
      const last = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000 });
      const fix =
        last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
      setPosition({ latitude: fix.coords.latitude, longitude: fix.coords.longitude });
    } catch {
      setError("Couldn't find your location — check that location is on and try again.");
    } finally {
      setLocating(false);
    }
  }, []);

  const clear = useCallback(() => {
    setPosition(null);
    setError(null);
  }, []);

  return { position, locating, error, locate, clear };
};

export default useNearMe;
