import { useQuery } from "@tanstack/react-query";
import { getPublicSessionApi } from "../../api/public/sessions";

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
      if (LIVE.includes(session?.status)) return 10 * 1000;
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
