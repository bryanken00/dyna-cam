/**
 * Request hooks — the public venue list (PLAN-009 Book tab, CR-030 / CR-050)
 */
import { useQuery } from "@tanstack/react-query";
import { IS_DEMO } from "../../constants";
import { demoDelay, demoEnvelope } from "../../constants/demo";
import { demoVenues } from "../../constants/demoPlayer";
import { getVenuesApi } from "../api/venues";

export const VENUES_KEY = ["venues"];

/** Every venue that takes online bookings, with its pin and today's hours. */
export const useVenues = () =>
  useQuery({
    queryKey: VENUES_KEY,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (IS_DEMO) {
        await demoDelay();
        return demoEnvelope("Venues", demoVenues());
      }
      return getVenuesApi();
    },
  });
