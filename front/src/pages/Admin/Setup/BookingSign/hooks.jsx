import { useCallback, useEffect } from "react";
import { useParams } from "react-router";
import { decodeHTML } from "../../../../utils/decode-html";
import { useGetBookingSettings } from "../../../../services/requests/admin/bookingSettings";

/**
 * PLAN-003: the printable "Book a court" sign for a venue's online booking
 * link. Like the court sign, it takes the dark theme off the document while
 * open (a printed sign is dark ink on white) and puts it back on close.
 */
export const useBookingSignHooks = () => {
  const { venueId } = useParams();

  const { data, isLoading, error } = useGetBookingSettings(venueId);
  // settings: { venueName, venuePhone, venueLogoUrl (signed), bookingUrl, … }
  const settings = data?.data?.settings || null;

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
    settings,
    venueName: decodeHTML(settings?.venueName),
    venuePhone: settings?.venuePhone || null,
    logoUrl: settings?.venueLogoUrl || null,
    bookingUrl: settings?.bookingUrl || null,
    isLoading,
    error,
    handlePrint,
  };
};
