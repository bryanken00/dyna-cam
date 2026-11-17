import { useMutation, useQuery } from "@tanstack/react-query";
import { getPublicCourtApi, savePublicClipApi } from "../../api/public/courts";

// Query: the court a QR code points to. A 404 means the code is not valid —
// don't retry it.
export const useGetPublicCourt = (qrToken) => {
  return useQuery({
    queryKey: ["publicCourt", qrToken],
    queryFn: () => getPublicCourtApi(qrToken),
    enabled: !!qrToken,
    staleTime: 15 * 1000,
    retry: (count, error) => error?.response?.status !== 404 && count < 2,
    // While the camera is offline, check again now and then so the button
    // comes back on its own
    refetchInterval: (query) =>
      query.state.data?.data?.court?.cameraReady === false ? 20 * 1000 : false,
  });
};

// Mutation: save the last 60 seconds. The page handles errors itself (offline,
// rate limit), so no toast here.
export const useSavePublicClip = () => {
  return useMutation({
    mutationFn: savePublicClipApi,
  });
};
