import { useCallback, useEffect, useState } from "react";
import { useLocation, useParams } from "react-router";
import { toast } from "sonner";
import { decodeHTML } from "../../../utils/decode-html";
import { copyText } from "../../../utils/clipboard";
import { useGetPublicClip } from "../../../services/requests/public/clips";

/** About how long a clip takes to save — drives the progress bar only. */
const EXPECTED_SAVE_MS = 75 * 1000;

export const useClipPageHooks = () => {
  const { shareToken } = useParams();
  const location = useLocation();
  // Set by the court page when this moment had already been saved by someone
  const merged = !!location.state?.merged;

  const { data, isLoading, error, refetch, isFetching } =
    useGetPublicClip(shareToken);

  const clip = data?.data?.clip || null;
  const notFound = error?.response?.status === 404;
  const isPending = clip?.status === "Pending";

  // Progress "feel" while saving: time since this page opened, eased towards
  // 95% — the real signal is the status poll (every 3 s, in the query hook).
  const [startedAt] = useState(() => Date.now());
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (!isPending) return undefined;
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 500);
    return () => clearInterval(id);
  }, [isPending, startedAt]);
  const progress = Math.min(
    95,
    Math.round(8 + (elapsedMs / EXPECTED_SAVE_MS) * 87),
  );

  const courtName = decodeHTML(clip?.courtName);
  const venueName = decodeHTML(clip?.venueName);

  const handleShare = useCallback(async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${courtName} replay`,
          text: `Check out this rally at ${venueName}`,
          url,
        });
        return;
      } catch (err) {
        // The player closed the share sheet — nothing to do
        if (err?.name === "AbortError") return;
      }
    }
    const ok = await copyText(url);
    if (ok) toast.success("Link copied — paste it anywhere to share");
    else toast.error("Couldn't copy the link");
  }, [courtName, venueName]);

  return {
    clip,
    courtName,
    venueName,
    merged,
    isLoading,
    isFetching,
    notFound,
    loadError: !notFound ? error : null,
    refetch,
    progress,
    handleShare,
  };
};
