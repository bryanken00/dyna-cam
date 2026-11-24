import { useCallback, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { decodeHTML } from "../../../utils/decode-html";
import { copyText } from "../../../utils/clipboard";
import { useWindowSize } from "../../../hooks/useWindowSize";
import { confirm } from "../../../store/confirmStore";
import {
  useDeletePublicCapture,
  useEndPublicGame,
  useGetPublicSession,
  usePublicPreview,
  usePublicStreamLink,
  useSavePublicCapture,
  useStopPublicStream,
} from "../../../services/requests/public/sessions";

export const useSessionPageHooks = () => {
  // CR-035: two columns from Tailwind's lg (1024px); phones keep the one column
  const { width } = useWindowSize();
  const { shareToken } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } =
    useGetPublicSession(shareToken);
  // CR-025: Save the last … from this page
  const saveCapture = useSavePublicCapture(shareToken);
  // CR-029: Preview a stretch before saving it
  const previewStretch = usePublicPreview(shareToken);
  // CR-028: the courtside device's other controls
  const endGame = useEndPublicGame(shareToken);
  const deleteCapture = useDeletePublicCapture(shareToken);
  const streamLink = usePublicStreamLink(shareToken);
  const stopStream = useStopPublicStream(shareToken);

  const session = data?.data?.session || null;
  // CR-025: the court's live video (null unless recording) and the save limits
  const live = data?.data?.live || null;
  const capture = data?.data?.capture || null;
  // CR-028: the player's own Facebook / YouTube stream
  const stream = data?.data?.stream || null;
  const canStream = !!data?.data?.canStream;
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

  // CR-028: End game, as on the court device
  const handleEndGame = useCallback(async () => {
    const ok = await confirm({
      title: "End the game?",
      description: "Recording stops and the whole game is saved for you.",
      confirmText: "End game",
      cancelText: "Keep recording",
      danger: true,
    });
    if (ok) endGame.mutate();
  }, [endGame]);

  // CR-028: delete a save — frees one of the game's saves
  const handleDeleteCapture = useCallback(
    async (item) => {
      const waiting = ["Queued", "Saving"].includes(item.status);
      const ok = await confirm({
        title: `Delete Save ${item.number}?`,
        description: waiting
          ? "It won't be made, and it won't appear on this page."
          : "Its video is removed from this page.",
        confirmText: "Delete",
        cancelText: "Keep",
        danger: true,
      });
      if (ok) deleteCapture.mutate({ number: item.number, savedAt: item.savedAt });
    },
    [deleteCapture],
  );

  // CR-028: add or change the player's stream on the stream setup page
  const handleOpenStream = useCallback(() => {
    streamLink.mutate(undefined, {
      onSuccess: (response) => {
        const url = response?.data?.url;
        if (!url) return;
        // The API builds it from APP_URL; open its path on this site
        navigate(new URL(url, window.location.origin).pathname);
      },
    });
  }, [streamLink, navigate]);

  const handleStopStream = useCallback(async () => {
    const ok = await confirm({
      title: "Stop streaming?",
      description: "The recording keeps going.",
      confirmText: "Stop streaming",
      cancelText: "Keep streaming",
      danger: true,
    });
    if (ok) stopStream.mutate();
  }, [stopStream]);

  return {
    session,
    live,
    capture,
    isRecording,
    since: dataUpdatedAt,
    saveCapture,
    previewStretch,
    stream,
    canStream,
    handleEndGame,
    isEnding: endGame.isPending,
    handleDeleteCapture,
    deletingNumber: deleteCapture.isPending ? deleteCapture.variables?.number : null,
    handleOpenStream,
    isOpeningStream: streamLink.isPending,
    handleStopStream,
    isStoppingStream: stopStream.isPending,
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
    wide: width >= 1024,
  };
};
