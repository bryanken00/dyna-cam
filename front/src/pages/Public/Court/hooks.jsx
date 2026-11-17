import { useCallback, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { decodeHTML } from "../../../utils/decode-html";
import {
  useGetPublicCourt,
  useSavePublicClip,
} from "../../../services/requests/public/courts";

/** Turn a failed save into the sentence the player sees under the button. */
const saveErrorMessage = (error) => {
  const status = error?.response?.status;
  const apiMessage = error?.response?.data?.message;
  if (error?.response?.data?.code === "CAMERA_OFFLINE" || status === 503) {
    return (
      apiMessage ||
      "This court's camera is offline right now, so nothing can be saved. Please tell the front desk."
    );
  }
  if (status === 429) {
    return apiMessage || "Too many saves — wait a moment and try again.";
  }
  if (!error?.response) {
    return "Couldn't reach Dyna Cam — check your connection and try again.";
  }
  return apiMessage || "Something went wrong. Please try again.";
};

export const useCourtPageHooks = () => {
  const { qrToken } = useParams();
  const navigate = useNavigate();

  const { data, isLoading, error, refetch, isFetching } =
    useGetPublicCourt(qrToken);
  const saveMutation = useSavePublicClip();
  const [saveError, setSaveError] = useState("");

  const court = data?.data?.court || null;
  const notFound = error?.response?.status === 404;

  const handleSave = useCallback(() => {
    setSaveError("");
    saveMutation.mutate(qrToken, {
      onSuccess: (response) => {
        const { shareToken, merged } = response?.data || {};
        if (!shareToken) {
          setSaveError("Something went wrong. Please try again.");
          return;
        }
        // `merged`: someone saved this same moment seconds ago — same clip
        navigate(`/clip/${shareToken}`, { state: { merged: !!merged } });
      },
      onError: (err) => {
        setSaveError(saveErrorMessage(err));
        // Offline / gone: refresh the court so the page shows its real state
        const status = err?.response?.status;
        if (status === 503 || status === 404) refetch();
      },
    });
  }, [qrToken, saveMutation, navigate, refetch]);

  return {
    court,
    venueName: decodeHTML(court?.venueName),
    courtName: decodeHTML(court?.name),
    clipSeconds: court?.clipSeconds || 60,
    cameraReady: !!court?.cameraReady,
    liveWatchUrl: court?.liveWatchUrl || null,
    isLoading,
    isFetching,
    notFound,
    loadError: !notFound ? error : null,
    refetch,
    handleSave,
    isSaving: saveMutation.isPending,
    saveError,
  };
};
