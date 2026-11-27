import { useCallback, useState } from "react";
import { useParams } from "react-router";

import { usePermissions } from "../../../../hooks/usePermissions";
import { confirm } from "../../../../store/confirmStore";
import { decodeHTML } from "../../../../utils/decode-html";
import {
  useCheckInSpot,
  useEndPlayGame,
  useFillQueue,
  useGetPlayQueue,
  useGetPlaySession,
  useLineUpGame,
  usePauseQueue,
  useRestSpot,
  useSwapPlayGame,
  useVoidPlayGame,
} from "../../../../services/requests/admin/openPlay";

/**
 * PLAN-009 phase D — the queue screen for an Open Play session, made for a
 * tablet at the court: courts with their games, who's next, the line. The queue
 * refreshes itself every 10 seconds, so two tablets stay in step.
 */
export const useOpenPlayQueueHooks = () => {
  const { playSessionId } = useParams();
  const { hasPermission } = usePermissions();
  const canWrite = hasPermission("open_play", null, "write");
  const { data: sessionData } = useGetPlaySession(playSessionId);
  const { data, isLoading, error, refetch, isFetching } = useGetPlayQueue(playSessionId);
  const queue = data?.data?.queue || null;
  const session = sessionData?.data?.session || null;

  const fill = useFillQueue();
  const lineUp = useLineUpGame();
  const pause = usePauseQueue();
  const endGame = useEndPlayGame();
  const voidGame = useVoidPlayGame();
  const swap = useSwapPlayGame();
  const rest = useRestSpot();
  const checkIn = useCheckInSpot();

  // Scores typed on each court card: { [playGameId]: { a, b } }
  const [scores, setScores] = useState({});
  const handleScore = useCallback((playGameId, side, value) => {
    const clean = value.replace(/\D/g, "").slice(0, 2);
    setScores((prev) => ({ ...prev, [playGameId]: { ...prev[playGameId], [side]: clean } }));
  }, []);

  const handleEnd = useCallback(
    (game) => {
      const s = scores[game.playGameId] || {};
      const data = s.a && s.b ? { scoreA: Number(s.a), scoreB: Number(s.b) } : {};
      endGame.mutate({ playSessionId, playGameId: game.playGameId, data });
    },
    [endGame, playSessionId, scores],
  );

  const handleVoid = useCallback(
    async (game) => {
      const ok = await confirm({
        title: "Call this game off?",
        description: "Its four players keep their place in line, and the court gets the next game.",
        confirmText: "Call it off",
        cancelText: "Keep playing",
        danger: true,
      });
      if (ok) voidGame.mutate({ playSessionId, playGameId: game.playGameId });
    },
    [voidGame, playSessionId],
  );

  return {
    canWrite,
    title: session ? decodeHTML(session.title) : "Open Play",
    session,
    queue,
    isLoading,
    isFetching,
    error,
    refetch,
    scores,
    handleScore,
    handleEnd,
    handleVoid,
    handleFill: () => fill.mutate({ playSessionId }),
    handleLineUp: () => lineUp.mutate({ playSessionId }),
    handlePause: () => pause.mutate({ playSessionId, data: { paused: !queue?.paused } }),
    handleSwap: (game, outSignupId, inSignupId) =>
      swap.mutate({ playSessionId, playGameId: game.playGameId, data: { outSignupId, inSignupId } }),
    handleRest: (spot, resting) => rest.mutate({ playSessionId, playSignupId: spot.playSignupId, data: { resting } }),
    handleCheckIn: (spot) => checkIn.mutate(spot.playSignupId),
    busy: fill.isPending || lineUp.isPending || pause.isPending || endGame.isPending || voidGame.isPending || swap.isPending || rest.isPending,
  };
};
