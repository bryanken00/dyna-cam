import { useCallback, useState } from "react";

import { usePlayerSignedIn } from "../../../store/playerStore";
import { useGetPlayerGames, useGetPlayerMe } from "../../../services/requests/public/player";

/**
 * `/me/games` (PLAN-006): the signed-in player's game log — bookings still to
 * play, then past ones a page at a time, each with its games and their
 * Google Drive links.
 */
export const useMyGamesHooks = () => {
  const signedIn = usePlayerSignedIn();
  const [page, setPage] = useState(1);

  const { data: meData } = useGetPlayerMe();
  const { data, isLoading, isFetching, error, refetch } = useGetPlayerGames(page);
  const log = data?.data || null;
  const pagination = log?.pagination || { page: 1, pages: 0, total: 0 };

  const handleOlder = useCallback(() => setPage((p) => p + 1), []);
  const handleNewer = useCallback(() => setPage((p) => Math.max(1, p - 1)), []);

  return {
    signedIn,
    player: meData?.data?.player || null,
    // Upcoming ones come with page 1 only
    upcoming: page === 1 ? log?.upcoming || [] : [],
    past: log?.past || [],
    page,
    pages: pagination.pages,
    totalPast: pagination.total,
    isLoading: signedIn && isLoading,
    isFetching,
    loadError: error && error?.response?.status !== 401 ? error : null,
    refetch,
    handleOlder,
    handleNewer,
  };
};
