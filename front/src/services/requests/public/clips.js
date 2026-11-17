import { useQuery } from "@tanstack/react-query";
import { getPublicClipApi } from "../../api/public/clips";

// Query: a shared clip. Polls every 3 s while it is still being saved, and
// stops as soon as it is Ready, Failed or Expired. A 404 is final.
export const useGetPublicClip = (shareToken) => {
  return useQuery({
    queryKey: ["publicClip", shareToken],
    queryFn: () => getPublicClipApi(shareToken),
    enabled: !!shareToken,
    retry: (count, error) => error?.response?.status !== 404 && count < 2,
    refetchInterval: (query) =>
      query.state.data?.data?.clip?.status === "Pending" ? 3000 : false,
    // A refetch hands back a freshly signed video link; swapping it under a
    // playing <video> would restart it, so don't refetch on focus.
    refetchOnWindowFocus: false,
  });
};
