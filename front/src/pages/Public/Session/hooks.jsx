import { useCallback, useMemo, useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { decodeHTML } from "../../../utils/decode-html";
import { copyText } from "../../../utils/clipboard";
import {
  useGetPublicSession,
  useSavePublicCapture,
} from "../../../services/requests/public/sessions";

export const useSessionPageHooks = () => {
  const { shareToken } = useParams();
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } =
    useGetPublicSession(shareToken);
  // CR-025: Save the last … from this page
  const saveCapture = useSavePublicCapture(shareToken);

  const session = data?.data?.session || null;
  // CR-025: the court's live video (null unless recording) and the save limits
  const live = data?.data?.live || null;
  const capture = data?.data?.capture || null;
  const isRecording = session?.status === "Recording";
  const notFound = error?.response?.status === 404;
  const parts = useMemo(() => session?.parts || [], [session]);
  // CR-003: the whole game, one video per camera (Cam 1 / Cam 2 tabs)
  const videos = useMemo(() => session?.videos || [], [session]);
  // CR-013: stretches saved from the courtside device ("Save 1 · 8:00 – 10:00")
  const captures = useMemo(() => session?.captures || [], [session]);
  const [cameraTab, setCameraTab] = useState(null);
  const activeVideo =
    videos.find((video) => video.camera === cameraTab) || videos[0] || null;
  const twoCameras = parts.some((part) => part.camera > 0) || videos.length > 1;

  // CR-006: after End game, "Saving your game…" while the box makes the file,
  // then "uploading N%" until a whole video is ready
  const hasReadyVideo = videos.some((video) => ["Ready", "Expired"].includes(video.status));
  const saving =
    session &&
    (session.status === "Processing" ||
      (session.savingWholeVideo && !hasReadyVideo && !videos.some((v) => v.status === "Failed")))
      ? { percent: session.uploadPercent ?? null }
      : null;
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
    live,
    capture,
    isRecording,
    since: dataUpdatedAt,
    saveCapture,
    parts,
    videos,
    captures,
    activeVideo,
    setCameraTab,
    twoCameras,
    saving,
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
