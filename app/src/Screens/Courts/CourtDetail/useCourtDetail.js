import { useState } from "react";
import usePermissions from "@/hooks/usePermissions";
import { useSaveClipNow } from "@/services/requests/clips";
import { useGetCourt } from "@/services/requests/courts";

/**
 * State for one court: the court itself, "Save clip now" and its result.
 *
 * `result` holds the last save's `{ clipId, shareUrl, merged }` while the
 * result sheet is open; null = closed.
 */
export const useCourtDetail = (courtId) => {
  const { can } = usePermissions();
  const query = useGetCourt(courtId);
  const saveClip = useSaveClipNow();
  const [result, setResult] = useState(null);

  const court = query.data?.data?.court ?? null;

  // Same rule the API applies (clips.controller.js POST /): an Active court
  // with a camera whose box is online. The button stays visible otherwise,
  // with the reason, so staff know why it is off.
  const blockedReason = !court
    ? null
    : court.status !== "Active"
      ? "This court is inactive."
      : !court.camera?.configured
        ? "This court has no camera set up."
        : !court.recorderOnline
          ? "The venue's recorder box is offline, so nothing can be saved."
          : null;

  return {
    court,
    isLoading: query.isLoading,
    isError: query.isError,
    errorMessage: query.error?.response?.data?.message,
    isRefreshing: query.isRefetching,
    refresh: query.refetch,
    // permissions — clips write covers both saving and booking
    canSave: can("clips", null, "write"),
    canBook: can("clips", null, "write"),
    canViewClips: can("clips"),
    // save clip now
    blockedReason,
    saving: saveClip.isPending,
    save: () =>
      saveClip.mutate(
        { courtId },
        { onSuccess: (response) => setResult(response.data) },
      ),
    result,
    closeResult: () => setResult(null),
  };
};

export default useCourtDetail;
