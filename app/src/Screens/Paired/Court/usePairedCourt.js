import { useNavigation } from "@react-navigation/native";
import { SCREEN_NAVIGATION } from "@/constants/navigations";
import {
  useGetCourtRecentClips,
  useGetPairedCourts,
  useRecordClip,
} from "@/services/requests/pairedApp";

/**
 * State for one court on a paired phone: the court (from the cached court
 * list — there is no single-court endpoint, and the list is already loaded),
 * Record, and the court's recent clips.
 *
 * Record opens the QR screen the moment the API answers; the clip is still
 * "Saving…" then, and the QR screen polls until it's Ready. The QR works
 * straight away either way — the share page waits for the clip itself.
 */
export const usePairedCourt = (courtId) => {
  const navigation = useNavigation();
  const courtsQuery = useGetPairedCourts();
  const recentQuery = useGetCourtRecentClips(courtId, 10);
  const record = useRecordClip();

  const court =
    (courtsQuery.data?.data?.courts ?? []).find((c) => c.courtId === courtId) ??
    null;

  const openQr = (clip, extra = {}) =>
    navigation.navigate(SCREEN_NAVIGATION.Paired.ShareQr, {
      clipId: clip.clipId,
      shareUrl: clip.shareUrl,
      courtName: court?.name ?? clip.courtName,
      ...extra,
    });

  return {
    court,
    // Still loading the list, or the court left it (deactivated on the web)
    courtLoading: courtsQuery.isLoading,
    courtMissing: Boolean(courtsQuery.data) && !court,
    connectionError: courtsQuery.error ?? recentQuery.error,
    recent: recentQuery.data?.data?.clips ?? [],
    recentLoading: recentQuery.isLoading,
    isRefreshing: courtsQuery.isRefetching || recentQuery.isRefetching,
    refresh: () => {
      courtsQuery.refetch();
      recentQuery.refetch();
    },
    canRecord: Boolean(court?.canRecord),
    recording: record.isPending,
    record: () => {
      if (!court || record.isPending) return;
      record.mutate(court, {
        onSuccess: (response) =>
          openQr(response.data, { merged: Boolean(response.data?.merged) }),
      });
    },
    openQr,
  };
};

export default usePairedCourt;
