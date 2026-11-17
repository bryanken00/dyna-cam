import { useEffect, useState } from "react";
import {
  revokeThisPhone,
  useGetPairedCourts,
  useGetPairedMe,
} from "@/services/requests/pairedApp";
import { usePairedStore } from "@/store/usePairedStore";

/**
 * State for the paired phone's home: its venue's courts, the phone's own
 * details, and the "This phone" sheet.
 *
 * The venue and phone name come from the pairing first (instant, offline)
 * and are refreshed from GET /app/me, so a rename on the web shows up here.
 * The court list refreshes itself every 30 s (camera status changes on its
 * own) and every 5 s while the API can't be reached.
 */
export const usePairedCourts = () => {
  const venue = usePairedStore((s) => s.venue);
  const pairedApp = usePairedStore((s) => s.pairedApp);
  const setDetails = usePairedStore((s) => s.setDetails);
  const unpair = usePairedStore((s) => s.unpair);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const me = useGetPairedMe();
  const courtsQuery = useGetPairedCourts();

  const meData = me.data?.data;
  useEffect(() => {
    if (meData) setDetails({ pairedApp: meData.pairedApp, venue: meData.venue });
  }, [meData, setDetails]);

  const courts = courtsQuery.data?.data?.courts ?? [];

  return {
    venueName: venue?.name ?? "Courts",
    phoneName: pairedApp?.name,
    courts,
    isLoading: courtsQuery.isLoading,
    // A real API answer that isn't a connection problem (rare: 4xx)
    error: courtsQuery.error,
    hasData: Boolean(courtsQuery.data),
    isRefreshing: courtsQuery.isRefetching,
    refresh: () => {
      courtsQuery.refetch();
      me.refetch();
    },
    settingsOpen,
    openSettings: () => setSettingsOpen(true),
    closeSettings: () => setSettingsOpen(false),
    unpair: async () => {
      setSettingsOpen(false);
      // Revoke on the server first (best effort), then forget the token here
      await revokeThisPhone();
      unpair(null);
    },
  };
};

export default usePairedCourts;
