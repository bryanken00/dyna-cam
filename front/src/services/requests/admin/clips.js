import { toast } from "sonner";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  getClipsApi,
  getClipOptionsApi,
  createClipApi,
  deleteClipApi,
} from "../../api/admin/clips";
import { copyText } from "../../../utils/clipboard";

const copyLinkAction = (shareUrl) =>
  shareUrl
    ? {
        label: "Copy link",
        onClick: async () => {
          const ok = await copyText(shareUrl);
          if (ok) toast.success("Share link copied");
          else toast.error("Couldn't copy the link");
        },
      }
    : undefined;

// Query: Get all clips (filters: venueId, courtId, source, status, dateFrom, dateTo)
export const useGetClips = (filters = {}) => {
  return useQuery({
    queryKey: ["clips", filters],
    queryFn: () => getClipsApi(filters),
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
    // Pending clips turn Ready within a minute or two — keep the list moving
    refetchInterval: (query) =>
      query.state.data?.data?.clips?.some((c) =>
        ["Pending", "Processing"].includes(c.status),
      )
        ? 15 * 1000
        : false,
  });
};

// Query: venues + courts for the filters → { venues, courts }
export const useGetClipOptions = (options = {}) => {
  return useQuery({
    queryKey: ["clips", "options"],
    queryFn: getClipOptionsApi,
    staleTime: 5 * 60 * 1000,
    ...options,
  });
};

// Mutation: Save a clip now (staff). The new row shows up as Pending / Staff.
export const useCreateClip = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createClipApi,
    onSuccess: (response) => {
      const { shareUrl, merged } = response?.data || {};
      if (merged) {
        toast.info("This moment is already being saved", {
          description: "Someone saved this court a few seconds ago — same clip.",
          action: copyLinkAction(shareUrl),
        });
      } else {
        toast.success("Saving the clip", {
          description: "It appears below as Pending and is ready in about a minute.",
          action: copyLinkAction(shareUrl),
        });
      }
      queryClient.invalidateQueries({ queryKey: ["clips"] });
    },
    onError: (error) => {
      const status = error.response?.status;
      if (status === 503 || error.response?.data?.code === "CAMERA_OFFLINE") {
        toast.error("This court's camera or recorder box is offline", {
          description: "Nothing can be saved until it is back online.",
        });
      } else if (status === 404) {
        toast.error("That court isn't active", {
          description: "The court or its venue may be inactive or deleted.",
        });
      } else {
        toast.error(error.response?.data?.message || "Failed to save the clip");
      }
    },
  });
};

// Mutation: Delete a clip (and its files)
export const useDeleteClip = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteClipApi,
    onSuccess: () => {
      toast.success("Clip deleted successfully");
      queryClient.invalidateQueries({ queryKey: ["clips"] });
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || "Failed to delete clip");
    },
  });
};
