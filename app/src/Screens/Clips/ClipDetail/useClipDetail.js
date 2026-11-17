import { Alert, Linking } from "react-native";
import usePermissions from "@/hooks/usePermissions";
import { useGetClip } from "@/services/requests/clips";
import { PAYABLE_CLIP_STATUSES, fileUrl } from "@/utils/dynaCam";

/**
 * Opens a signed video link outside the app — the phone's video player or
 * browser streams it (the API serves uploads with HTTP Range support).
 *
 * Why not an in-app player: neither `expo-video` nor `expo-av` is installed,
 * and both are native modules — adding one means a new dev build for every
 * tester. The system player plays the same file with seeking and
 * full-screen for free. Swap this for `expo-video` once a native rebuild is
 * planned anyway.
 */
const openExternally = async (path) => {
  const url = fileUrl(path);
  if (!url) return;
  try {
    await Linking.openURL(url);
  } catch (error) {
    console.error("Couldn't open the video:", error);
    Alert.alert(
      "Can't open the video",
      "No app on this phone could open the link. Share it instead and open it in a browser.",
    );
  }
};

/**
 * State for one clip: the clip, what the user may do with it, and the
 * play / download handlers.
 */
export const useClipDetail = (clipId) => {
  const { can } = usePermissions();
  const query = useGetClip(clipId);
  const clip = query.data?.data?.clip ?? null;

  // Same conditions the API checks before it takes a payment
  // (payments.controller.js POST /): Unpaid and still payable.
  const canTakePayment =
    Boolean(clip) &&
    can("payments", null, "write") &&
    clip.paymentStatus === "Unpaid" &&
    Boolean(clip.payCode) &&
    PAYABLE_CLIP_STATUSES.includes(clip.status);

  return {
    clip,
    isLoading: query.isLoading,
    isError: query.isError,
    errorMessage: query.error?.response?.data?.message,
    isRefreshing: query.isRefetching,
    refresh: query.refetch,
    canTakePayment,
    canOpenSession: can("clips"),
    play: () => openExternally(clip?.videoUrl),
    download: () => openExternally(clip?.downloadUrl),
  };
};

export default useClipDetail;
