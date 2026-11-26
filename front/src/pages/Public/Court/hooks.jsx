import { useParams } from "react-router";

import { decodeHTML } from "../../../utils/decode-html";
import { getImageUrl } from "../../../utils/upload";
import { useGetPublicCourt } from "../../../services/requests/public/courts";

/**
 * `/court/:qrToken` — an old court QR sign (CR-045: nothing starts from it any
 * more). It names the court and points to where recording starts now: the
 * player's booking, in My games or their email — and to booking this court.
 */
export const useCourtPageHooks = () => {
  const { qrToken } = useParams();
  const { data, isLoading, error } = useGetPublicCourt(qrToken);
  const court = data?.data?.court || null;

  return {
    isLoading,
    notFound: error?.response?.status === 404,
    courtName: decodeHTML(court?.name || ""),
    venueName: decodeHTML(court?.venueName || ""),
    logo: getImageUrl(court?.venueLogoUrl),
    bookingPath: court?.bookingToken ? `/book/${court.bookingToken}` : "/book",
  };
};
