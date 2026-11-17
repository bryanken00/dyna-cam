import { useRoute } from "@react-navigation/native";
import { useGetPairedClip } from "@/services/requests/pairedApp";

/**
 * State for the QR screen. The link comes in with the navigation params
 * (Record's response, or the recent-clips row), so the QR draws instantly;
 * GET /app/clips/:id then fills in the status — polled every 3 s while
 * "Pending" (saving) and every 5 s while the API can't be reached.
 */
export const useShareQr = () => {
  const { clipId, shareUrl, courtName, merged } = useRoute().params ?? {};
  const query = useGetPairedClip(clipId);
  const clip = query.data?.data?.clip ?? null;

  return {
    clip,
    shareUrl: clip?.shareUrl ?? shareUrl ?? null,
    courtName: clip?.courtName ?? courtName,
    merged: Boolean(merged),
    status: clip?.status ?? (query.isLoading ? "Pending" : null),
    failureReason: clip?.failureReason ?? null,
    error: query.error,
    notFound: query.error?.response?.status === 404,
  };
};

export default useShareQr;
