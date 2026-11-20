import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getPublicSessionApi,
  savePublicCaptureApi,
} from "../../api/public/sessions";

const LIVE = ["Scheduled", "Recording", "Processing"];

// Query: a booked session. Polls every 10 s until it is Ready or Failed, then
// every 15 s while its whole video is being joined (CR-003).
// A 404 (invalid or cancelled) is final.
export const useGetPublicSession = (shareToken) => {
  return useQuery({
    queryKey: ["publicSession", shareToken],
    queryFn: () => getPublicSessionApi(shareToken),
    enabled: !!shareToken,
    retry: (count, error) => error?.response?.status !== 404 && count < 2,
    refetchInterval: (query) => {
      const session = query.state.data?.data?.session;
      // CR-015: not paid yet — open by itself once staff record the payment
      if (LIVE.includes(session?.status) || session?.locked) return 10 * 1000;
      // CR-003: the game is in; its whole video is being put together.
      // CR-013: or a save from the courtside device is still being made
      const savingCapture = session?.captures?.some((c) => ["Saving", "Queued"].includes(c.status));
      return session?.savingWholeVideo || savingCapture ? 15 * 1000 : false;
    },
    // A refetch re-signs the video links; don't swap them under a playing
    // video just because the tab regained focus
    refetchOnWindowFocus: false,
  });
};

// Mutation: CR-025 — Save the last N minutes from the game's page. The page
// shows refusals itself (too early, at the limit), so no toast here; on
// success the game is re-read so the save shows under "Your saves".
export const useSavePublicCapture = (shareToken) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (seconds) => savePublicCaptureApi({ shareToken, seconds }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["publicSession", shareToken],
      });
    },
  });
};
