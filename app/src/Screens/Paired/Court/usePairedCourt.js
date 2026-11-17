import { useNavigation } from "@react-navigation/native";
import { useMemo, useState } from "react";
import { SCREEN_NAVIGATION } from "@/constants/navigations";
import {
  useEndRecording,
  useGetCourtRecentClips,
  useGetCourtSessions,
  useGetPairedCourts,
  useRecordClip,
  useStartRecording,
} from "@/services/requests/pairedApp";
import { isConnectionError } from "@/utils/dynaCam";

const RECENT_LIMIT = 10;

/** What to show under the big button when Start or End fails. */
const actionMessage = (error) => {
  if (!error) return null;
  if (error.response?.status === 401) return null; // unpaired — moving on
  if (isConnectionError(error)) {
    return "Can't reach Dyna Cam — check the Wi-Fi and try again.";
  }
  // 503 CAMERA_OFFLINE, 409 booking soon / not recording, 404 — the API's words
  return error.response?.data?.message || "Something went wrong — try again.";
};

/**
 * State for one court on a paired phone (PLAN-002 Phase D):
 *
 *  • **Start / End recording** — the whole game. Start never asks; the
 *    screen confirms End. After End, the game's QR opens (it's Processing
 *    while its parts upload; the link already works).
 *  • **Save last 60 s** — the earlier one-minute clip, unchanged.
 *  • **Recent** — the court's games and 60-second clips together, newest
 *    first; a tap opens the right QR.
 *
 * The court comes from the cached court list (no single-court endpoint);
 * Start/End patch it immediately, so the timer shows without waiting.
 * Start/End errors are kept here and shown inline under the button.
 */
export const usePairedCourt = (courtId) => {
  const navigation = useNavigation();
  const courtsQuery = useGetPairedCourts();
  const clipsQuery = useGetCourtRecentClips(courtId, RECENT_LIMIT);
  const sessionsQuery = useGetCourtSessions(courtId, RECENT_LIMIT);
  const record = useRecordClip();
  const start = useStartRecording();
  const end = useEndRecording();
  const [note, setNote] = useState(null);

  const court =
    (courtsQuery.data?.data?.courts ?? []).find((c) => c.courtId === courtId) ??
    null;

  // Games and clips in one list, newest first. Both timestamps are Manila
  // "YYYY-MM-DD HH:mm:ss" strings, so they compare as text.
  const recent = useMemo(() => {
    const games = (sessionsQuery.data?.data?.sessions ?? []).map((g) => ({
      kind: "session",
      key: `s-${g.sessionId}`,
      at: g.startAt,
      item: g,
    }));
    const clips = (clipsQuery.data?.data?.clips ?? []).map((c) => ({
      kind: "clip",
      key: `c-${c.clipId}`,
      at: c.requestedAt,
      item: c,
    }));
    return [...games, ...clips]
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
      .slice(0, RECENT_LIMIT);
  }, [sessionsQuery.data, clipsQuery.data]);

  const openQr = (kind, item, extra = {}) =>
    navigation.navigate(SCREEN_NAVIGATION.Paired.ShareQr, {
      kind,
      id: kind === "session" ? item.sessionId : item.clipId,
      shareUrl: item.shareUrl,
      courtName: court?.name ?? item.courtName,
      ...extra,
    });

  const clearMessages = () => {
    setNote(null);
    start.reset();
    end.reset();
  };

  return {
    court,
    recording: court?.recording ?? null,
    // When `recording`'s seconds were measured — the timer ticks from here
    recordingSince: courtsQuery.dataUpdatedAt,
    courtLoading: courtsQuery.isLoading,
    courtMissing: Boolean(courtsQuery.data) && !court,
    connectionError: courtsQuery.error ?? sessionsQuery.error ?? clipsQuery.error,
    recent,
    recentLoading: clipsQuery.isLoading || sessionsQuery.isLoading,
    isRefreshing:
      courtsQuery.isRefetching || clipsQuery.isRefetching || sessionsQuery.isRefetching,
    refresh: () => {
      courtsQuery.refetch();
      clipsQuery.refetch();
      sessionsQuery.refetch();
    },
    canRecord: Boolean(court?.canRecord),

    // ── Whole game ──
    starting: start.isPending,
    ending: end.isPending,
    error: actionMessage(start.error ?? end.error),
    note,
    startRecording: () => {
      if (!court || start.isPending) return;
      clearMessages();
      start.mutate(court, {
        onSuccess: (response) => {
          // Another phone (or a double tap) had already started it
          if (response?.data?.recording?.already) {
            const by = response.data?.recording?.startedBy;
            setNote(by ? `Already recording — started by ${by}.` : "Already recording.");
          }
        },
      });
    },
    endRecording: () => {
      if (!court || end.isPending) return;
      clearMessages();
      end.mutate(court.courtId, {
        onSuccess: (response) => {
          const session = response.data?.session;
          if (session) openQr("session", session);
        },
      });
    },

    // ── 60-second clip ──
    savingClip: record.isPending,
    saveClip: () => {
      if (!court || record.isPending) return;
      clearMessages();
      record.mutate(court, {
        onSuccess: (response) =>
          openQr("clip", response.data, {
            merged: Boolean(response.data?.merged),
          }),
      });
    },

    openQr,
  };
};

export default usePairedCourt;
