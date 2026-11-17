/**
 * Request hooks — The paired device's session (PLAN-002 Phase E)
 *
 * Side effects live here: cache updates and the pairing store. Screens import
 * from this file, never from api/. Query keys start with "session";
 * Navigation drops them whenever the pairing changes.
 *
 * ── Staying paired ──────────────────────────────────────────────────────────
 * Only a 401 TOKEN_INVALID unpairs, handled once in the device axios
 * instance. "Can't reach the API" (no response, 5xx) is temporary: the
 * session query keeps polling every 5 s regardless, so the screen's
 * "Can't reach Dyna Cam — retrying" banner clears by itself.
 *
 * ── Demo mode ───────────────────────────────────────────────────────────────
 * Resolves from `constants/demo.js` with no network: a session recording
 * since 3 minutes ago, no live video; Stop → Processing → Ready after ~8 s.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { IS_DEMO } from "../../constants";
import {
  demoDelay,
  demoDeviceSession,
  demoEnvelope,
  demoError,
  demoStopSession,
} from "../../constants/demo";
import { usePairedStore } from "../../store/usePairedStore";
import {
  getDeviceSessionApi,
  stopSessionApi,
  unpairDeviceApi,
} from "../api/session";

export const SESSION_KEY = ["session"];

/** How often the device re-reads its session (status, timers, live link). */
const POLL_MS = 5000;

// ─────────────────────────────────────────────────────────────────────────────
// useGetDeviceSession — GET /app/session, every 5 s
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Polled every 5 s for as long as the device is paired: it carries the
 * status, the timers, the saving progress, and a fresh live-video link
 * before the old one expires. It also tells the store once the session has
 * ended, so a later 401 can say "The session has ended".
 */
export const useGetDeviceSession = () => {
  const token = usePairedStore((s) => s.token);
  const markSessionEnded = usePairedStore((s) => s.markSessionEnded);

  const query = useQuery({
    queryKey: SESSION_KEY,
    queryFn: async () => {
      if (IS_DEMO) {
        await new Promise((r) => setTimeout(r, 300));
        return demoEnvelope("Session", demoDeviceSession());
      }
      return getDeviceSessionApi();
    },
    enabled: Boolean(token),
    staleTime: 0,
    refetchInterval: POLL_MS,
  });

  const ended = query.data?.data?.unpairInSeconds != null;
  useEffect(() => {
    if (ended) markSessionEnded();
  }, [ended, markSessionEnded]);

  return query;
};

// ─────────────────────────────────────────────────────────────────────────────
// useStopSession — "Stop recording"
// ─────────────────────────────────────────────────────────────────────────────
/**
 * On success the answer goes straight into the session cache, so the device
 * switches to the Ended screen without waiting for the next poll. A 409 ("it
 * isn't recording", e.g. still Scheduled) is shown by the screen from
 * `error`, and the session is re-read in case it already ended.
 */
export const useStopSession = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (IS_DEMO) {
        await demoDelay();
        const stopped = demoStopSession();
        if (!stopped) throw demoError(409, "This session isn't recording");
        return demoEnvelope("Recording stopped — the game is being saved", stopped);
      }
      return stopSessionApi();
    },
    retry: false,
    onSuccess: (response) => {
      const { session, unpairInSeconds } = response.data ?? {};
      queryClient.setQueryData(SESSION_KEY, (old) =>
        old
          ? { ...old, data: { ...old.data, session, unpairInSeconds, live: null } }
          : old,
      );
      queryClient.invalidateQueries({ queryKey: SESSION_KEY });
    },
    onError: (error) => {
      if (error?.response?.status === 409) {
        queryClient.invalidateQueries({ queryKey: SESSION_KEY });
      }
    },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// useFinishPairing — "Done", and the unpair countdown reaching 0
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Returns `finish({ notify, notice })`: unpair this device on the server
 * (`notify`, best effort — offline or in demo nothing is sent, and the token
 * dies with the grace period anyway), then forget the token here. Navigation
 * returns to "Pair this device", showing `notice` if given.
 *
 * A plain async function rather than a mutation: there is nothing to show
 * while it runs — the device leaves this screen either way.
 */
export const useFinishPairing = () => {
  const unpair = usePairedStore((s) => s.unpair);

  return async ({ notify = true, notice = null } = {}) => {
    if (notify && !IS_DEMO) {
      try {
        await unpairDeviceApi();
      } catch {
        // Never log it — an axios error carries the token in its headers
      }
    }
    unpair(notice);
  };
};
