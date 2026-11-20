import { toast } from "sonner";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  getSessionsApi,
  getSessionByIdApi,
  createSessionApi,
  cancelSessionApi,
  endSessionApi,
  extendSessionApi,
  updateSessionEmailApi,
  sendSessionDriveEmailApi,
  reuploadSessionDriveApi,
  createSessionPairingCodeApi,
  cancelSessionPairingCodeApi,
  unpairSessionDeviceApi,
  stopSessionStreamApi,
  retrySessionVideoApi,
} from "../../api/admin/sessions";

/** Statuses that still change on their own (parts arrive, status settles). */
export const SESSION_LIVE_STATUSES = ["Scheduled", "Recording", "Processing"];

// Query: Get all sessions. Refreshes every 30 s while a row is still moving.
export const useGetSessions = (filters = {}) => {
  return useQuery({
    queryKey: ["sessions", filters],
    queryFn: () => getSessionsApi(filters),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
    refetchInterval: (query) =>
      query.state.data?.data?.sessions?.some((s) =>
        SESSION_LIVE_STATUSES.includes(s.status),
      )
        ? 30 * 1000
        : false,
  });
};

// Query: one session with its parts, devices and live pairing keys.
// Refreshes every 15 s while it is live — every 5 s while a key is waiting,
// so a device shows up soon after it pairs.
export const useGetSessionById = (sessionId) => {
  return useQuery({
    queryKey: ["sessions", sessionId],
    queryFn: () => getSessionByIdApi(sessionId),
    enabled: !!sessionId,
    staleTime: 15 * 1000,
    refetchInterval: (query) => {
      const session = query.state.data?.data?.session;
      if (session?.pairingCodes?.length > 0) return 5 * 1000;
      if (SESSION_LIVE_STATUSES.includes(session?.status)) return 15 * 1000;
      // CR-003: the whole video is being joined
      return session?.wholeVideo === "Pending" ? 15 * 1000 : false;
    },
  });
};

// Mutation: New game (CR-016: `startNow: true` + durationMinutes — records at once)
export const useCreateSession = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createSessionApi,
    onSuccess: (response) => {
      toast.success(response?.message || "Game created");
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (error) => {
      toast.error(
        error.response?.status === 409
          ? "This court already has a game — end it before starting a new one"
          : error.response?.data?.message || "Failed to create the game",
      );
    },
  });
};

// Mutation: CR-016 Add time to a recording game ({ sessionId, minutes })
export const useExtendSession = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: extendSessionApi,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || "Failed to add time");
      // A 409 means the game has ended meanwhile — show the real status
      if (error.response?.status === 409) {
        queryClient.invalidateQueries({ queryKey: ["sessions"] });
      }
    },
  });
};

// Mutation: CR-018 fix the player's email ({ sessionId, email })
export const useUpdateSessionEmail = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateSessionEmailApi,
    onSuccess: (response) => {
      toast.success(response?.message || "Player email saved");
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || "Failed to save the email");
    },
  });
};

// Mutation: CR-018 email the game's Google Drive link to the player now (sessionId)
export const useSendSessionDriveEmail = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: sendSessionDriveEmailApi,
    onSuccess: (response) => {
      toast.success(response?.message || "Google Drive link emailed");
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || "Failed to send the email");
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
};

// Mutation: CR-018 (2026-11-20) upload the game to Google Drive again (sessionId)
export const useReuploadSessionDrive = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: reuploadSessionDriveApi,
    onSuccess: (response) => {
      toast.success(response?.message || "Uploading to Google Drive");
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || "Failed to re-upload to Google Drive");
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
};

// Mutation: Cancel a session that hasn't started
export const useCancelSession = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: cancelSessionApi,
    onSuccess: () => {
      toast.success("Session cancelled");
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (error) => {
      toast.error(
        error.response?.data?.message || "Failed to cancel the session",
      );
      // A 409 means it has started meanwhile — show the real status
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
};

// Mutation: End a recording session now (footage so far is still delivered)
export const useEndSession = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: endSessionApi,
    onSuccess: (response) => {
      toast.success(
        response?.message || "Session ended — its footage is being saved",
      );
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      queryClient.invalidateQueries({ queryKey: ["clips"] }); // new parts
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || "Failed to end the session");
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
};

// Mutation: a 6-digit key that pairs a device to this session
export const useCreateSessionPairingCode = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ sessionId, data }) => createSessionPairingCodeApi(sessionId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (error) => {
      toast.error(
        error.response?.data?.message || "Failed to create a pairing key",
      );
      // A 409 means the session has ended meanwhile — show the real status
      if (error.response?.status === 409) {
        queryClient.invalidateQueries({ queryKey: ["sessions"] });
      }
    },
  });
};

// Mutation: cancel a session key nobody has used yet
export const useCancelSessionPairingCode = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ sessionId, pairingCodeId }) =>
      cancelSessionPairingCodeApi(sessionId, pairingCodeId),
    onSuccess: () => {
      toast.success("Pairing key cancelled");
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || "Failed to cancel the key");
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
};

// Mutation: unpair a device from its session
export const useUnpairSessionDevice = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ sessionId, pairedAppId }) =>
      unpairSessionDeviceApi(sessionId, pairedAppId),
    onSuccess: () => {
      toast.success("Device unpaired");
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || "Failed to unpair the device");
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
};

// Mutation: stop the player's own live stream
export const useStopSessionStream = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: stopSessionStreamApi,
    onSuccess: () => {
      toast.success("Stream stopped");
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || "Failed to stop the stream");
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
};

// Mutation: CR-003 — join a whole-game video again after it failed
export const useRetrySessionVideo = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: retrySessionVideoApi,
    onSuccess: (response) => {
      toast.success(response?.message || "Joining the whole video again");
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || "Couldn't try again");
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
};
