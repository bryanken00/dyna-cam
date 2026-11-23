import { useMutation, useQuery } from "@tanstack/react-query";
import {
  checkInAtCourtApi,
  getPublicCourtApi,
  startPublicGameApi,
} from "../../api/public/courts";

// Query: the court a QR code points to. A 404 means the code is not valid
// (new code issued, court gone) — don't retry it.
export const useGetPublicCourt = (qrToken) => {
  return useQuery({
    queryKey: ["publicCourt", qrToken],
    queryFn: () => getPublicCourtApi(qrToken),
    enabled: !!qrToken,
    staleTime: 15 * 1000,
    retry: (count, error) => error?.response?.status !== 404 && count < 2,
    // While the court is busy or its camera offline, check again now and then
    // so Start game comes back on its own
    refetchInterval: (query) => {
      const court = query.state.data?.data?.court;
      return court && (court.busy || !court.cameraReady) ? 20 * 1000 : false;
    },
  });
};

// Mutation: PLAN-003 Phase D — check a booking in with its code. The page
// shows errors itself, so no toast here.
export const useCheckInAtCourt = () => {
  return useMutation({ mutationFn: checkInAtCourtApi });
};

// Mutation: CR-027 — start the game. The page shows errors itself (busy,
// offline, rate limit), so no toast here.
export const useStartPublicGame = () => {
  return useMutation({
    mutationFn: startPublicGameApi,
  });
};
