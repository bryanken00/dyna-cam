import { useCallback, useMemo } from "react";
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

  // Parts that aren't due yet (recording still to come)
  const remaining = Math.max(0, (Number(session?.partsTotal) || 0) - parts.length);
  const readyCount = parts.filter((p) => p.status === "Ready").length;
  // The soonest a ready part expires — what "available until" should promise
  const expiresAt = useMemo(
    () =>
      parts
        .filter((p) => p.status === "Ready" && p.expiresAt)
        .map((p) => p.expiresAt)
        .sort()[0] || null,
    [parts],
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
