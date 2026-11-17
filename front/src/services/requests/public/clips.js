import { useQuery } from "@tanstack/react-query";
import { getPublicClipApi } from "../../api/public/clips";

// Query: a shared clip. Polls every 3 s while it is still being saved, every
// 5 s while a Ready clip is locked (unpaid) so it unlocks by itself once staff
// record the cash, and stops otherwise. A 404 is final.
export const useGetPublicClip = (shareToken) => {
  return useQuery({
    queryKey: ["publicClip", shareToken],
    queryFn: () => getPublicClipApi(shareToken),
    enabled: !!shareToken,
    retry: (count, error) => error?.response?.status !== 404 && count < 2,
    refetchInterval: (query) => {
      const clip = query.state.data?.data?.clip;
      if (clip?.status === "Pending") return 3000;
      if (clip?.status === "Ready" && clip?.locked) return 5000;
      return false;
    },
    // A refetch hands back a freshly signed video link; swapping it under a
    // playing <video> would restart it, so don't refetch on focus.
    refetchOnWindowFocus: false,
  });
};
