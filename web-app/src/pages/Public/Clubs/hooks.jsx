import { useMemo, useState } from "react";

import { usePlayerSignedIn } from "../../../store/playerStore";
import { decodeHTML } from "../../../utils/decode-html";
import { useGetClubs, useGetMyClubs } from "../../../services/requests/public/clubs";

const toCard = (c) => ({
  key: c.key,
  to: `/clubs/${c.key}`,
  name: decodeHTML(c.name),
  venue: decodeHTML(c.venue?.name || c.venueName || ""),
  members: c.members,
  approval: c.joinPolicy === "Approval",
  status: c.status || null,
});

/** `/clubs` (PLAN-009 phase F): my clubs, then every club to find, by name or venue. */
export const useClubsHooks = () => {
  const signedIn = usePlayerSignedIn();
  const [search, setSearch] = useState("");
  const { data, isLoading, error, refetch, isFetching } = useGetClubs();
  const { data: mineData } = useGetMyClubs();
  const mine = useMemo(() => (mineData?.data?.clubs || []).map(toCard), [mineData]);
  const mineKeys = new Set(mine.map((c) => c.key));
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const all = (data?.data?.clubs || [])
    .map(toCard)
    .filter((c) => !mineKeys.has(c.key))
    .filter((c) => words.every((w) => `${c.name} ${c.venue}`.toLowerCase().includes(w)));
  return { signedIn, mine, all, search, handleSearch: setSearch, isLoading, isFetching, loadError: error, refetch };
};
