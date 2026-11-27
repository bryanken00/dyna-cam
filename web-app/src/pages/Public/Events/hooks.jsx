import { useMemo } from "react";

import { decodeHTML } from "../../../utils/decode-html";
import { formatPeso } from "../../../utils/dynaCam";
import { levelRange } from "../../../utils/openPlay";
import { dateRange } from "../../../utils/tournaments";
import { useGetTournaments } from "../../../services/requests/public/tournaments";

/**
 * `/events` (PLAN-009 phase E): tournaments at every venue — registration open
 * first, then the ones closed or under way.
 */
export const useEventsHooks = () => {
  const { data, isLoading, error, refetch, isFetching } = useGetTournaments();
  const events = useMemo(
    () =>
      (data?.data?.tournaments || []).map((t) => ({
        key: t.key,
        to: `/events/${t.key}`,
        name: decodeHTML(t.name),
        when: dateRange(t.startDate, t.endDate),
        venue: decodeHTML(t.venue.name),
        open: t.registrationOpen,
        live: t.status === "Live",
        divisions: t.divisions.map((d) => ({
          name: decodeHTML(d.name),
          line: [
            levelRange(d.minLevel, d.maxLevel),
            d.teamSize === 2 ? "doubles" : "singles",
            d.entryFee > 0 ? `${formatPeso(d.entryFee)} / team` : "free",
            d.spotsLeft > 0 ? `${d.spotsLeft} left` : "full",
          ].join(" · "),
        })),
      })),
    [data],
  );
  return { events, isLoading, isFetching, loadError: error, refetch };
};
