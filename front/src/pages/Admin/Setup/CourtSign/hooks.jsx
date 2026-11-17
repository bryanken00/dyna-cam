import { useCallback, useEffect } from "react";
import { useParams } from "react-router";
import { decodeHTML } from "../../../../utils/decode-html";
import { useGetCourtById } from "../../../../services/requests/admin/courts";

/**
 * The printable court sign. A printed sign is always dark ink on white paper,
 * so while this page is open it takes the dark theme off the document and
 * puts the user's theme back when it closes (it only touches the <html> class,
 * never the saved theme choice).
 */
export const useCourtSignHooks = () => {
  const { courtId } = useParams();

  const { data: courtData, isLoading, error } = useGetCourtById(courtId);
  // court: { name, venueName, venueLogoUrl (signed), qrUrl, … }
  const court = courtData?.data?.court || null;

  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    root.classList.remove("dark");
    return () => {
      if (wasDark) root.classList.add("dark");
    };
  }, []);

  const handlePrint = useCallback(() => window.print(), []);

  return {
    court,
    courtName: decodeHTML(court?.name),
    venueName: decodeHTML(court?.venueName),
    logoUrl: court?.venueLogoUrl || null,
    isLoading,
    error,
    handlePrint,
  };
};
