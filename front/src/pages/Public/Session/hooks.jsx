import { useCallback, useMemo, useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { decodeHTML } from "../../../utils/decode-html";
import { copyText } from "../../../utils/clipboard";
import { useGetPublicSession } from "../../../services/requests/public/sessions";

export const useSessionPageHooks = () => {
  const { shareToken } = useParams();
  const { data, isLoading, error, refetch, isFetching } =
    useGetPublicSession(shareToken);

  const session = data?.data?.session || null;
  const notFound = error?.response?.status === 404;
  const parts = useMemo(() => session?.parts || [], [session]);
  // CR-003: the whole game, one video per camera (Cam 1 / Cam 2 tabs)
  const videos = useMemo(() => session?.videos || [], [session]);
  const [cameraTab, setCameraTab] = useState(null);
  const activeVideo =
    videos.find((video) => video.camera === cameraTab) || videos[0] || null;
  const twoCameras = parts.some((part) => part.camera > 0) || videos.length > 1;

  // Parts that aren't due yet (recording still to come)
  const remaining = Math.max(0, (Number(session?.partsTotal) || 0) - parts.length);
  const readyCount =
    parts.filter((p) => p.status === "Ready").length +
    videos.filter((v) => v.status === "Ready").length;
  // The soonest a ready part expires — what "available until" should promise
  const expiresAt = useMemo(
    () =>
      [...parts, ...videos]
        .filter((item) => item.status === "Ready" && item.expiresAt)
        .map((item) => item.expiresAt)
        .sort()[0] || null,
    [parts, videos],
  );

  const courtName = decodeHTML(session?.courtName);
  const venueName = decodeHTML(session?.venueName);

  const handleShare = useCallback(async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${courtName} session`,
          text: `Our game at ${venueName}`,
          url,
        });
        return;
      } catch (err) {
        if (err?.name === "AbortError") return;
      }
    }
    const ok = await copyText(url);
    if (ok) toast.success("Link copied — paste it anywhere to share");
    else toast.error("Couldn't copy the link");
  }, [courtName, venueName]);

  return {
    session,
    parts,
    videos,
    activeVideo,
    setCameraTab,
    twoCameras,
    savingWholeVideo: Boolean(session?.savingWholeVideo),
    remaining,
    readyCount,
    expiresAt,
    courtName,
    venueName,
    playerName: decodeHTML(session?.playerName),
    isLoading,
    isFetching,
    notFound,
    loadError: !notFound ? error : null,
    refetch,
    handleShare,
  };
};
