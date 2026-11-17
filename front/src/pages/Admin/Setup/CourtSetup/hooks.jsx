import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
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

/** The court's camera slots: `court.camera` and, optionally, `court.camera2`. */
const CAMERA_SLOTS = ["camera", "camera2"];

/** Has the box picked up this camera's current address? */
const hasSwitched = (camera) => camera?.live?.cameraVersion === camera?.version;

/**
 * `/admin/setup/venues/:venueId/courts/:courtId` — one court's setup:
 * Camera and Camera 2 (guided, each with its live check), QR sign, Button,
 * Live stream.
 */
export const useCourtSetupHooks = () => {
  const { venueId, courtId } = useParams();
  const { hasPermission } = usePermissions();
  const canWrite = hasPermission("venues", "courts", "write");

  // Live check after a camera save, per slot ("camera" | "camera2"): saved
  // on this visit, and whether we're still watching closely for the box to
  // switch to it
  const [justSaved, setJustSaved] = useState({});
  const [checking, setChecking] = useState({});
  const checkTimers = useRef({});

  const { data, isLoading, error, refetch, isFetching } = useGetCourtById(
    courtId,
    {
      // 5 s while the box hasn't switched to a just-saved camera (its report
      // is about the current address only when the versions match), else
      // 15 s for the preview
      refetchInterval: (query) => {
        const court = query.state.data?.data?.court;
        const waiting = CAMERA_SLOTS.some(
          (slot) => checking[slot] && !hasSwitched(court?.[slot]),
        );
        return waiting ? 5000 : 15000;
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

  // Called by a camera section after a successful save
  const handleCameraSaved = useCallback(
    (slot) => {
      setJustSaved((prev) => ({ ...prev, [slot]: true }));
      setChecking((prev) => ({ ...prev, [slot]: true }));
      if (courtId) requestPreview(courtId);
      clearTimeout(checkTimers.current[slot]);
      checkTimers.current[slot] = setTimeout(
        () => setChecking((prev) => ({ ...prev, [slot]: false })),
        LIVE_CHECK_MS,
      );
    },
    [courtId, requestPreview],
  );

  // CR-001: back from Google's consent screen — say how it went, once
  const [searchParams, setSearchParams] = useSearchParams();
  const driveResult = searchParams.get("drive");
  const driveReason = searchParams.get("reason");
  useEffect(() => {
    if (!driveResult) return;
    if (driveResult === "connected") {
      toast.success("Google Drive connected — new recordings on this court go there");
    } else if (driveResult === "error") {
      toast.error(driveReason || "Couldn't connect Google Drive. Try again.");
    }
    setSearchParams({}, { replace: true });
  }, [driveResult, driveReason, setSearchParams]);

  useEffect(() => {
    const timers = checkTimers.current;
    return () => Object.values(timers).forEach(clearTimeout);
  }, []);

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
