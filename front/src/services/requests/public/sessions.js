import { useQuery } from "@tanstack/react-query";
import { getPublicSessionApi } from "../../api/public/sessions";

const LIVE = ["Scheduled", "Recording", "Processing"];

// Query: a booked session. Polls every 10 s until it is Ready or Failed.
// A 404 (invalid or cancelled) is final.
export const useGetPublicSession = (shareToken) => {
  return useQuery({
    queryKey: ["publicSession", shareToken],
    queryFn: () => getPublicSessionApi(shareToken),
    enabled: !!shareToken,
    retry: (count, error) => error?.response?.status !== 404 && count < 2,
    refetchInterval: (query) =>
      LIVE.includes(query.state.data?.data?.session?.status) ? 10 * 1000 : false,
    // A refetch re-signs the video links; don't swap them under a playing
    // video just because the tab regained focus
    refetchOnWindowFocus: false,
  });
};
