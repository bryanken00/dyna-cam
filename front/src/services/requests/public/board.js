import { useQuery } from "@tanstack/react-query";
import { getCourtBoardApi } from "../../api/public/board";

// Query: CR-038 — the TV board, refreshed every minute (and kept refreshing in
// the background: a TV never focuses the window). A 404 means the link was
// turned off or replaced — don't retry it, but keep checking now and then.
export const useGetCourtBoard = (displayToken) => {
  return useQuery({
    queryKey: ["courtBoard", displayToken],
    queryFn: () => getCourtBoardApi(displayToken),
    enabled: !!displayToken,
    refetchInterval: 60 * 1000,
    refetchIntervalInBackground: true,
    retry: (count, error) => error?.response?.status !== 404 && count < 3,
  });
};
