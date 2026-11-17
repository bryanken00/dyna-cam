/**
 * Request hooks — Clips (permission clips)
 *
 * Side effects live here: toasts and cache invalidation. Screens and module
 * hooks import from this file, never from api/.
 *
 * Demo mode: every hook resolves from `constants/demo.js` without touching
 * the network, in the API's exact envelope. "Save clip now" succeeds and
 * saves nothing.
 */
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import Toast from "react-native-toast-message";
import { IS_DEMO } from "../../constants";
import {
  DEMO_CLIPS,
  DEMO_COURTS,
  DEMO_VENUES,
  demoDelay,
  demoEnvelope,
  demoError,
  demoPage,
} from "../../constants/demo";
import {
  createClipApi,
  getClipApi,
  getClipOptionsApi,
  getClipsApi,
} from "../api/clips";

const KEY = "clips";

/** Filters the fixtures the way the server's WHERE clause would. */
const demoList = ({
  venueId,
  courtId,
  source,
  status,
  paymentStatus,
  dateFrom,
  dateTo,
  ...paging
} = {}) => {
  const rows = DEMO_CLIPS.filter((c) => {
    const day = c.requestedAt.slice(0, 10);
    return (
      (status ? c.status === status : c.status !== "Deleted") &&
      (!venueId || c.venueId === venueId) &&
      (!courtId || c.courtId === courtId) &&
      (!source || c.source === source) &&
      (!paymentStatus || c.paymentStatus === paymentStatus) &&
      (!dateFrom || day >= dateFrom) &&
      (!dateTo || day <= dateTo)
    );
  });
  return demoPage("clips", "Clips retrieved successfully", rows, paging);
};

// ─────────────────────────────────────────────────────────────────────────────
// useGetClips
// ─────────────────────────────────────────────────────────────────────────────
export const useGetClips = (params = {}, options = {}) => {
  return useQuery({
    queryKey: [KEY, params],
    queryFn: async () => {
      if (IS_DEMO) {
        await demoDelay();
        return demoList(params);
      }
      return getClipsApi(params);
    },
    placeholderData: keepPreviousData,
    ...options,
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// useGetClipOptions — venues + courts for filters and the booking form
// ─────────────────────────────────────────────────────────────────────────────
export const useGetClipOptions = (options = {}) => {
  return useQuery({
    queryKey: [KEY, "options"],
    queryFn: async () => {
      if (IS_DEMO) {
        await demoDelay();
        return demoEnvelope("Clip filter options", {
          venues: DEMO_VENUES.map(({ venueId, name }) => ({ venueId, name })),
          courts: DEMO_COURTS.map((c) => ({
            courtId: c.courtId,
            name: c.name,
            venueId: c.venueId,
            venueName: c.venueName,
            active: c.status === "Active",
          })),
        });
      }
      return getClipOptionsApi();
    },
    staleTime: 5 * 60 * 1000,
    ...options,
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// useGetClip
// ─────────────────────────────────────────────────────────────────────────────
export const useGetClip = (clipId) => {
  return useQuery({
    queryKey: [KEY, clipId],
    queryFn: async () => {
      if (IS_DEMO) {
        await demoDelay();
        const clip = DEMO_CLIPS.find((c) => c.clipId === clipId);
        if (!clip) throw demoError(404, "Clip not found");
        return demoEnvelope("Clip retrieved successfully", { clip });
      }
      return getClipApi(clipId);
    },
    enabled: Boolean(clipId),
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// useSaveClipNow — POST /clips { courtId }
// ─────────────────────────────────────────────────────────────────────────────
/**
 * The caller shows the result (share link + QR) from `data.data`:
 * `{ clipId, shareUrl, merged }`. `merged` means a save on this court a few
 * seconds earlier already covers this moment — same clip, same link.
 */
export const useSaveClipNow = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ courtId }) => {
      if (IS_DEMO) {
        await demoDelay();
        const court = DEMO_COURTS.find((c) => c.courtId === courtId);
        if (!court?.recorderOnline || !court?.camera?.configured) {
          throw demoError(
            503,
            "This court's camera or recorder box is offline, so nothing can be saved",
            "CAMERA_OFFLINE",
          );
        }
        // Points at an existing fixture so "Open clip" has something to show
        return demoEnvelope("Saving the clip", {
          clipId: DEMO_CLIPS[0].clipId,
          shareUrl: DEMO_CLIPS[0].shareUrl,
          merged: false,
        });
      }
      return createClipApi({ courtId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [KEY] });
      if (IS_DEMO) {
        Toast.show({
          type: "success",
          text1: "Clip requested",
          text2: "Demo mode — nothing was saved",
        });
      }
    },
    onError: (error) => {
      const offline = error.response?.data?.code === "CAMERA_OFFLINE";
      Toast.show({
        type: "error",
        text1: offline ? "Camera offline" : "Couldn't save the clip",
        text2: error.response?.data?.message || "Something went wrong",
      });
    },
  });
};
