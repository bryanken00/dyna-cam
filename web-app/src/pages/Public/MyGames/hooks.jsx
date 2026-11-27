import { useCallback, useMemo, useState } from "react";
import dayjs from "dayjs";

import { usePlayerSignedIn } from "../../../store/playerStore";
import {
  useGetPlayerFollows,
  useGetPlayerGames,
  useGetPlayerMe,
  useGetRecentVenues,
} from "../../../services/requests/public/player";
import { useGetMyPlaySpots } from "../../../services/requests/public/openPlay";
import { useGetMyTeams } from "../../../services/requests/public/tournaments";
import { teamLine } from "../../../utils/tournaments";
import { decodeHTML } from "../../../utils/decode-html";
import { formatTimeRange } from "../../../utils/dynaCam";
import { getImageUrl } from "../../../utils/upload";

/** PLAN-009 phase B: a venue tile on the Play tab. */
const toTile = (v) => ({
  key: v.key,
  name: decodeHTML(v.name),
  logo: getImageUrl(v.logoUrl),
  to: v.bookingToken ? `/book/${v.bookingToken}` : null,
});

/**
 * `/me/games` (PLAN-006): the signed-in player's game log — bookings still to
 * play, then past ones a page at a time, each with its games and their
 * Google Drive links. PLAN-009 phase B: the Play tab — Book again and
 * Following on top.
 */
export const useMyGamesHooks = () => {
  const signedIn = usePlayerSignedIn();
  const [page, setPage] = useState(1);

  const { data: meData } = useGetPlayerMe();
  const { data, isLoading, isFetching, error, refetch } = useGetPlayerGames(page);
  const log = data?.data || null;
  const pagination = log?.pagination || { page: 1, pages: 0, total: 0 };

  // PLAN-009 phase B: Book again and Following
  const { data: recentData } = useGetRecentVenues();
  const { data: followsData } = useGetPlayerFollows();
  const recent = useMemo(() => (recentData?.data?.venues || []).map(toTile), [recentData]);
  const following = useMemo(() => (followsData?.data?.venues || []).map(toTile), [followsData]);
  // PLAN-009 phase C: my Open Play spots still to come
  const { data: spotsData } = useGetMyPlaySpots("upcoming");
  // PLAN-009 phase E: my tournament teams
  const { data: teamsData } = useGetMyTeams();
  const tournamentTeams = useMemo(
    () =>
      (teamsData?.data?.teams || [])
        .filter((t) => t.status !== "Withdrawn" && t.tournament.status !== "Cancelled")
        .map((t) => ({
          key: t.teamCode,
          to: `/events/${t.tournament.key}`,
          tournament: decodeHTML(t.tournament.name),
          team: decodeHTML(t.name),
          division: decodeHTML(t.divisionName),
          line: teamLine(t),
          needsAction: t.status === "Pending" && t.captain && t.paymentStatus === "Unpaid",
        })),
    [teamsData],
  );
  // PLAN-009 phase D: Open Play sessions gone to, with their games
  const { data: pastSpotsData } = useGetMyPlaySpots("past");
  const playHistory = useMemo(
    () =>
      (pastSpotsData?.data?.spots || []).map((s) => {
        const wins = (s.games || []).filter((g) => g.won === true).length;
        const losses = (s.games || []).filter((g) => g.won === false).length;
        return {
          key: s.signupCode,
          to: `/open-play/${s.session.key}`,
          title: decodeHTML(s.session.title),
          when: dayjs(s.session.startAt).format("ddd, MMM D"),
          where: decodeHTML(s.session.venueName),
          status: s.status,
          games: s.games || [],
          record: wins + losses ? `${wins}W ${losses}L` : "",
        };
      }),
    [pastSpotsData],
  );
  const playSpots = useMemo(
    () =>
      (spotsData?.data?.spots || []).map((s) => ({
        key: s.signupCode,
        to: `/open-play/${s.session.key}`,
        title: decodeHTML(s.session.title),
        when: `${dayjs(s.session.startAt).format("ddd, MMM D")} · ${formatTimeRange(s.session.startAt, s.session.endAt)}`,
        where: decodeHTML(s.session.venueName),
        live: s.session.state === "Live",
        pending: s.status === "Pending",
      })),
    [spotsData],
  );

  const handleOlder = useCallback(() => setPage((p) => p + 1), []);
  const handleNewer = useCallback(() => setPage((p) => Math.max(1, p - 1)), []);

  return {
    signedIn,
    player: meData?.data?.player || null,
    // Upcoming ones come with page 1 only
    upcoming: page === 1 ? log?.upcoming || [] : [],
    past: log?.past || [],
    recent,
    following,
    playSpots,
    playHistory,
    tournamentTeams,
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
