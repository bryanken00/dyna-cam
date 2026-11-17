/**
 * Request hooks — Recording sessions (permission clips)
 *
 * Side effects live here: toasts and cache invalidation. Screens and module
 * hooks import from this file, never from api/.
 *
 * Demo mode: every hook resolves from `constants/demo.js` without touching
 * the network, in the API's exact envelope. Writes succeed and save nothing.
 */
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import Toast from "react-native-toast-message";
import { IS_DEMO } from "../../constants";
import {
  DEMO_SESSIONS,
  demoDelay,
  demoEnvelope,
  demoError,
  demoPage,
} from "../../constants/demo";
import {
  cancelSessionApi,
  createSessionApi,
  endSessionApi,
  getSessionApi,
  getSessionsApi,
} from "../api/sessions";

const KEY = "sessions";

const apiMessage = (error) =>
  error?.response?.data?.message || "Something went wrong";

const demoList = ({ venueId, courtId, status, search, ...paging } = {}) => {
  const q = search?.toLowerCase();
  const rows = DEMO_SESSIONS.filter(
    (s) =>
      (!status || s.status === status) &&
      (!venueId || s.venueId === venueId) &&
      (!courtId || s.courtId === courtId) &&
      (!q ||
        (s.playerName ?? "").toLowerCase().includes(q) ||
        s.courtName.toLowerCase().includes(q) ||
        s.venueName.toLowerCase().includes(q)),
  );
  return demoPage("sessions", "Sessions retrieved successfully", rows, paging);
};

/** A fixture session with parts shaped like GET /sessions/:id's. */
const demoDetail = (session) => ({
  ...session,
  parts: Array.from(
    {
      length:
        session.partsReady + (session.status === "Recording" ? 1 : 0),
    },
    (_, i) => ({
      clipId: `${session.sessionId}-part-${i}`,
      partIndex: i,
      windowStartAt: session.startAt,
      windowEndAt: session.endAt,
      durationSeconds: 300,
      status: i < session.partsReady ? "Ready" : "Processing",
      failureReason: null,
      expiresAt: null,
      videoUrl: null,
      downloadUrl: null,
      thumbnailUrl: null,
    }),
  ),
});

// ─────────────────────────────────────────────────────────────────────────────
// useGetSessions
// ─────────────────────────────────────────────────────────────────────────────
export const useGetSessions = (params = {}, options = {}) => {
  return useQuery({
    queryKey: [KEY, params],
    queryFn: async () => {
      if (IS_DEMO) {
        await demoDelay();
        return demoList(params);
      }
      return getSessionsApi(params);
    },
    placeholderData: keepPreviousData,
    ...options,
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// useGetSession — with its parts
// ─────────────────────────────────────────────────────────────────────────────
export const useGetSession = (sessionId) => {
  return useQuery({
    queryKey: [KEY, sessionId],
    queryFn: async () => {
      if (IS_DEMO) {
        await demoDelay();
        const session = DEMO_SESSIONS.find((s) => s.sessionId === sessionId);
        if (!session) throw demoError(404, "Session not found");
        return demoEnvelope("Session retrieved successfully", {
          session: demoDetail(session),
        });
      }
      return getSessionApi(sessionId);
    },
    enabled: Boolean(sessionId),
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// useBookSession
// ─────────────────────────────────────────────────────────────────────────────
/**
 * payload: { courtId, startAt: "YYYY-MM-DD HH:mm" (Manila), durationMinutes,
 *            playerName?, phone? }. The caller shows `data.data.shareUrl`.
 */
export const useBookSession = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload) => {
      if (IS_DEMO) {
        await demoDelay();
        return demoEnvelope("Session booked", {
          sessionId: "demo-session-new",
          startAt: `${payload.startAt}:00`,
          endAt: null,
          shareUrl: DEMO_SESSIONS[0].shareUrl,
        });
      }
      return createSessionApi(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [KEY] });
      Toast.show({
        type: "success",
        text1: "Session booked",
        ...(IS_DEMO && { text2: "Demo mode — nothing was saved" }),
      });
    },
    onError: (error) => {
      Toast.show({
        type: "error",
        text1: "Couldn't book the session",
        text2: apiMessage(error),
      });
    },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// useCancelSession — only before it starts
// ─────────────────────────────────────────────────────────────────────────────
export const useCancelSession = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sessionId) => {
      if (IS_DEMO) {
        await demoDelay();
        return demoEnvelope("Session cancelled");
      }
      return cancelSessionApi(sessionId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [KEY] });
      Toast.show({
        type: "success",
        text1: "Session cancelled",
        ...(IS_DEMO && { text2: "Demo mode — nothing was saved" }),
      });
    },
    onError: (error) => {
      Toast.show({
        type: "error",
        text1: "Couldn't cancel the session",
        text2: apiMessage(error),
      });
    },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// useEndSession — finish a running session now
// ─────────────────────────────────────────────────────────────────────────────
export const useEndSession = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sessionId) => {
      if (IS_DEMO) {
        await demoDelay();
        return demoEnvelope("Session ended — its footage is being saved", {
          endAt: null,
        });
      }
      return endSessionApi(sessionId);
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: [KEY] });
      // Ending creates the last parts, which are clips
      queryClient.invalidateQueries({ queryKey: ["clips"] });
      Toast.show({
        type: "success",
        text1: "Session ended",
        text2: IS_DEMO
          ? "Demo mode — nothing was saved"
          : response?.message || "Its footage is being saved",
      });
    },
    onError: (error) => {
      Toast.show({
        type: "error",
        text1: "Couldn't end the session",
        text2: apiMessage(error),
      });
    },
  });
};
