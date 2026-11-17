import { useGetDeviceSession, useStopSession } from "@/services/requests/session";
import { isConnectionError } from "@/utils/dynaCam";

/**
 * State for the Session screen: the session (polled every 5 s), its live
 * link, and Stop recording.
 *
 * `since` is when the last answer arrived — every running number on screen
 * (the REC timer) ticks from it, so it re-syncs on each poll.
 */
export const useSessionScreen = () => {
  const query = useGetDeviceSession();
  const stop = useStopSession();
  const data = query.data?.data ?? null;
  const session = data?.session ?? null;

  const stopError = stop.error
    ? stop.error.response?.status === 401
      ? null // unpaired — Navigation is already moving on
      : isConnectionError(stop.error)
        ? "Can't reach Dyna Cam — check the Wi-Fi and press Stop again."
        : stop.error.response?.data?.message || "Couldn't stop — try again."
    : null;

  return {
    session,
    live: data?.live ?? null,
    since: query.dataUpdatedAt,
    isLoading: query.isLoading,
    error: query.error,
    errorMessage: query.error?.response?.data?.message,
    refresh: query.refetch,
    isRecording: session?.status === "Recording",
    isScheduled: session?.status === "Scheduled",
    stopping: stop.isPending,
    stopError,
    stop: () => {
      if (stop.isPending) return;
      stop.reset();
      stop.mutate();
    },
  };
};

export default useSessionScreen;
