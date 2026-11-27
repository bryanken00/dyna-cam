import { useMemo, useState } from "react";
import dayjs from "dayjs";

import { decodeHTML } from "../../../utils/decode-html";
import { formatPeso, formatTimeRange, manilaNow } from "../../../utils/dynaCam";
import { levelFits, levelRange, spotsText } from "../../../utils/openPlay";
import { getImageUrl } from "../../../utils/upload";
import { useGetOpenPlaySessions } from "../../../services/requests/public/openPlay";
import { useGetPlayerSports } from "../../../services/requests/public/player";

const DAYS = 7;

/**
 * `/open-play` (PLAN-009 phase C): the next week's Open Play sessions at every
 * venue, by day, optionally only the ones that fit the player's level.
 * Phase F: `/coaching` is the same list of clinics (kind "Clinic").
 */
export const useOpenPlayListHooks = ({ kind = "OpenPlay" } = {}) => {
  const today = manilaNow().date;
  const [day, setDay] = useState(null); // null = the whole week
  const [myLevelOnly, setMyLevelOnly] = useState(false);
  const { data, isLoading, error, refetch, isFetching } = useGetOpenPlaySessions({ from: today, days: DAYS, kind });
  const { data: sportsData } = useGetPlayerSports();
  const myLevel = (sportsData?.data?.sports || []).find((s) => s.sport === "Pickleball")?.skillLevel || null;

  const days = useMemo(
    () =>
      Array.from({ length: DAYS }, (_, i) => {
        const d = dayjs(today).add(i, "day");
        return {
          value: d.format("YYYY-MM-DD"),
          top: i === 0 ? "Today" : i === 1 ? "Tmrw" : d.format("ddd"),
          bottom: d.format("MMM D"),
        };
      }),
    [today],
  );

  const all = useMemo(
    () =>
      (data?.data?.sessions || []).map((s) => ({
        key: s.key,
        to: `/open-play/${s.key}`,
        date: s.startAt.slice(0, 10),
        day: dayjs(s.startAt).format("ddd, MMM D"),
        weekday: dayjs(s.startAt).format("ddd"),
        dateNumber: dayjs(s.startAt).format("D"),
        time: formatTimeRange(s.startAt, s.endAt),
        live: s.state === "Live",
        title: decodeHTML(s.title),
        // PLAN-009 phase F
        coach: s.coachName ? decodeHTML(s.coachName) : "",
        club: s.club ? decodeHTML(s.club.name) : "",
        venue: decodeHTML(s.venue.name),
        logo: getImageUrl(s.venue.logoUrl),
        courts: decodeHTML(s.courts),
        level: levelRange(s.minLevel, s.maxLevel),
        fits: levelFits(myLevel, s.minLevel, s.maxLevel),
        spots: spotsText(s.spotsLeft),
        full: s.spotsLeft <= 0,
        fee: s.pricePerHead > 0 ? `${formatPeso(s.pricePerHead)} / player` : "Free",
      })),
    [data, myLevel],
  );

  const shown = all.filter((s) => (!day || s.date === day) && (!myLevelOnly || s.fits));

  return {
    days,
    day,
    handleDay: (value) => setDay((current) => (current === value ? null : value)),
    myLevel,
    myLevelOnly,
    handleMyLevel: () => setMyLevelOnly((v) => !v),
    sessions: shown,
    total: all.length,
    isLoading,
    isFetching,
    loadError: error,
    refetch,
  };
};
