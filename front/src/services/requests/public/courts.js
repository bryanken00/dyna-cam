import { useQuery } from "@tanstack/react-query";
import { getPublicCourtApi } from "../../api/public/courts";

// Query: the court a QR code points to. A 404 means the code is not valid
// (new code issued, court gone) — don't retry it.
export const useGetPublicCourt = (qrToken) => {
  return useQuery({
    queryKey: ["publicCourt", qrToken],
    queryFn: () => getPublicCourtApi(qrToken),
    enabled: !!qrToken,
    staleTime: 5 * 60 * 1000,
    retry: (count, error) => error?.response?.status !== 404 && count < 2,
  });
};
