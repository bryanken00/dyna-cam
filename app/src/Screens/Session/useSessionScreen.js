import {
  useGetDeviceSession,
  useDeleteCapture,
  useSaveCapture,
  useStopSession,
  useStopStream,
} from "@/services/requests/session";
import { isConnectionError } from "@/utils/dynaCam";
import { useStreamSetup } from "./useStreamSetup";

/** What to say when a Stop (recording or stream) fails. */
const actionError = (error, what) => {
  if (!error || error.response?.status === 401) return null; // unpaired — moving on
  if (isConnectionError(error)) {
    return `Can't reach Dyna Cam — check the Wi-Fi and ${what} again.`;
  }
  return error.response?.data?.message || "Something went wrong — try again.";
};

/**
 * State for the Session screen: the session (polled every 5 s), its live
 * link, End game, and the player's own stream (Phase G: the setup
 * sheet, Stop streaming).
 *
 * `since` is when the last answer arrived — every running number on screen
 * (the REC timer) ticks from it, so it re-syncs on each poll.
 */
export const useSessionScreen = () => {
  const query = useGetDeviceSession();
  const stop = useStopSession();
  const stopStream = useStopStream();
  const save = useSaveCapture();
  const removeCapture = useDeleteCapture();
  const data = query.data?.data ?? null;
  const session = data?.session ?? null;
  const stream = data?.stream ?? null;
  const streamSetup = useStreamSetup(stream);

  return {
    session,
    live: data?.live ?? null,
    since: query.dataUpdatedAt,
    isLoading: query.isLoading,
    error: query.error,
    errorMessage: query.error?.response?.data?.message,
    refresh: query.refetch,
    isRecording: session?.status === "Recording",
    // CR-013: "Save the last N min" — the mutation, whether it's possible, the saves
    save,
    removeCapture,
    capture: data?.capture ?? null,
    captures: data?.captures ?? [],
    isScheduled: session?.status === "Scheduled",
    stopping: stop.isPending,
    stopError: actionError(stop.error, "end the game"),
    stop: () => {
      if (stop.isPending) return;
      stop.reset();
      stop.mutate();
    },

    // ── The player's own stream ──
    stream,
    // Set up / change only before the game ends (the API 409s after)
    canStream: ["Scheduled", "Recording"].includes(session?.status),
    streamSetup,
    stoppingStream: stopStream.isPending,
    streamError: actionError(stopStream.error, "try"),
    stopStream: () => {
      if (stopStream.isPending) return;
      stopStream.reset();
      stopStream.mutate();
    },
  };
};

export default useSessionScreen;
