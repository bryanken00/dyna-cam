import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { usePermissions } from "../../../../hooks/usePermissions";
import { decodeHTML } from "../../../../utils/decode-html";
import {
  useGetCourtById,
  useRequestCourtPreview,
} from "../../../../services/requests/admin/courts";

/** How long the page watches closely for the box to report a new camera. */
const LIVE_CHECK_MS = 90 * 1000;
/** Ask the box for preview pictures this often (the API grants 2 minutes). */
const PREVIEW_EVERY_MS = 90 * 1000;

/**
 * `/admin/setup/venues/:venueId/courts/:courtId` — one court's setup:
 * Camera (guided, with the live check), QR sign, Button, Live stream.
 */
export const useCourtSetupHooks = () => {
  const { venueId, courtId } = useParams();
  const { hasPermission } = usePermissions();
  const canWrite = hasPermission("venues", "courts", "write");

  // Live check after a camera save: a camera was saved on this visit, and
  // whether we're still watching closely for the box to switch to it
  const [justSaved, setJustSaved] = useState(false);
  const [checking, setChecking] = useState(false);
  const checkTimer = useRef(null);

  const { data, isLoading, error, refetch, isFetching } = useGetCourtById(
    courtId,
    {
      // 5 s while the box hasn't switched to a just-saved camera (its report
      // is about the current address only when the versions match), else
      // 15 s for the preview
      refetchInterval: (query) => {
        const camera = query.state.data?.data?.court?.camera;
        const switched = camera?.live?.cameraVersion === camera?.version;
        return checking && !switched ? 5000 : 15000;
      },
      refetchIntervalInBackground: false,
    },
  );
  const court = data?.data?.court || null;

  // Ask the venue's box for preview pictures while this page is open
  const { mutate: requestPreview } = useRequestCourtPreview();
  useEffect(() => {
    if (!courtId) return undefined;
    const ask = () => {
      if (document.visibilityState === "visible") requestPreview(courtId);
    };
    ask();
    const id = setInterval(ask, PREVIEW_EVERY_MS);
    document.addEventListener("visibilitychange", ask);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", ask);
    };
  }, [courtId, requestPreview]);

  // Called by the camera section after a successful save
  const handleCameraSaved = useCallback(() => {
    setJustSaved(true);
    setChecking(true);
    if (courtId) requestPreview(courtId);
    clearTimeout(checkTimer.current);
    checkTimer.current = setTimeout(() => setChecking(false), LIVE_CHECK_MS);
  }, [courtId, requestPreview]);

  useEffect(() => () => clearTimeout(checkTimer.current), []);

  return {
    venueId: court?.venueId || venueId,
    courtId,
    court,
    courtName: decodeHTML(court?.name),
    venueName: decodeHTML(court?.venueName),
    isLoading,
    isFetching,
    error,
    notFound: error?.response?.status === 404,
    refetch,
    canWrite,
    justSaved,
    checking,
    handleCameraSaved,
  };
};
