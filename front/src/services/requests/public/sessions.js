import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deletePublicCaptureApi,
  endPublicGameApi,
  getPublicPreviewApi,
  getPublicSessionApi,
  getPublicStreamLinkApi,
  savePublicCaptureApi,
  stopPublicStreamApi,
} from "../../api/public/sessions";

const LIVE = ["Scheduled", "Recording", "Processing"];

// Query: a booked session. Polls every 10 s until it is Ready or Failed, then
// every 15 s while its whole video is being joined (CR-003).
// A 404 (invalid or cancelled) is final.
export const useGetPublicSession = (shareToken) => {
  return useQuery({
    queryKey: ["publicSession", shareToken],
    queryFn: () => getPublicSessionApi(shareToken),
    enabled: !!shareToken,
    retry: (count, error) => error?.response?.status !== 404 && count < 2,
    refetchInterval: (query) => {
      const session = query.state.data?.data?.session;
      // CR-015: not paid yet — open by itself once staff record the payment
      if (LIVE.includes(session?.status) || session?.locked) return 10 * 1000;
      // CR-003: the game is in; its whole video is being put together.
      // CR-013: or a save from the courtside device is still being made
      const savingCapture = session?.captures?.some((c) => ["Saving", "Queued"].includes(c.status));
      return session?.savingWholeVideo || savingCapture ? 15 * 1000 : false;
    },
    // A refetch re-signs the video links; don't swap them under a playing
    // video just because the tab regained focus
    refetchOnWindowFocus: false,
  });
};

// Mutation: CR-025 — Save the last N minutes from the game's page. The page
// shows refusals itself (too early, at the limit), so no toast here; on
// success the game is re-read so the save shows under "Your saves".
export const useSavePublicCapture = (shareToken) => {
  const queryClient = useQueryClient();
  return useMutation({
    // CR-029: { seconds } or { fromSeconds, toSeconds }
    mutationFn: (body) => savePublicCaptureApi({ shareToken, body }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["publicSession", shareToken],
      });
    },
  });
};

/** The API's sentence for a failed control, or a fallback. */
const failText = (error, fallback) =>
  !error?.response
    ? "Can't reach Dyna Cam — check your connection and try again."
    : error.response.data?.message || fallback;

/** A control on the game's page (CR-028): toast the answer, then re-read the game. */
const useGameControl = (shareToken, mutationFn, fallback) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (response) => {
      if (response?.message) toast.success(response.message);
    },
    onError: (error) => toast.error(failText(error, fallback)),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["publicSession", shareToken] }),
  });
};

// Mutation: CR-028 — End game
export const useEndPublicGame = (shareToken) =>
  useGameControl(shareToken, () => endPublicGameApi(shareToken), "Couldn't end the game — try again.");

// Mutation: CR-028 — delete a save ({ number, savedAt })
export const useDeletePublicCapture = (shareToken) =>
  useGameControl(
    shareToken,
    ({ number, savedAt }) => deletePublicCaptureApi({ shareToken, number, savedAt }),
    "Couldn't delete the save — try again.",
  );

// Mutation: CR-028 — stop the player's own stream
export const useStopPublicStream = (shareToken) =>
  useGameControl(shareToken, () => stopPublicStreamApi(shareToken), "Couldn't stop the stream — try again.");

// Mutation: CR-028 — a setup link for the player's own stream. The caller opens
// the link; errors are toasted.
export const usePublicStreamLink = (shareToken) =>
  useMutation({
    mutationFn: () => getPublicStreamLinkApi(shareToken),
    onError: (error) => toast.error(failText(error, "Couldn't open stream setup — try again.")),
  });

// Mutation: CR-029 — a replay link for a stretch ({ from, to }), for Preview.
// A fresh signed link each time (it expires), so a mutation, not a cached
// query. The Save card shows failures itself.
export const usePublicPreview = (shareToken) =>
  useMutation({
    mutationFn: ({ from, to }) => getPublicPreviewApi({ shareToken, from, to }),
  });
