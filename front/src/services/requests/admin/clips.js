import { useQuery } from "@tanstack/react-query";
import { getClipOptionsApi } from "../../api/admin/clips";

/** CR-024: the Clips page is gone; Sessions still uses the venue/court options. */

// Query: venues + courts for the filters → { venues, courts }
export const useGetClipOptions = (options = {}) => {
  return useQuery({
    queryKey: ["clips", "options"],
    queryFn: getClipOptionsApi,
    staleTime: 5 * 60 * 1000,
    ...options,
  });
};
