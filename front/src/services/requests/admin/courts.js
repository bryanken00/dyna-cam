import { toast } from "sonner";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  getCourtsApi,
  getCourtOptionsApi,
  getCourtByIdApi,
  createCourtApi,
  updateCourtApi,
  rotateCourtQrApi,
  requestCourtPreviewApi,
  deleteCourtApi,
} from "../../api/admin/courts";

// Query: Get all courts (filter ?venueId=)
export const useGetCourts = (filters = {}, options = {}) => {
  return useQuery({
    queryKey: ["courts", filters],
    queryFn: () => getCourtsApi(filters),
    staleTime: 60 * 1000, // recorderOnline changes — keep it fairly fresh
    placeholderData: keepPreviousData,
    ...options,
  });
};

// Query: venue options for this page's picker and filter → { venues }
export const useGetCourtOptions = (options = {}) => {
  return useQuery({
    queryKey: ["courts", "options"],
    queryFn: getCourtOptionsApi,
    staleTime: 5 * 60 * 1000,
    ...options,
  });
};

// Query: Get single court. `options` lets the camera setup page poll it.
export const useGetCourtById = (courtId, options = {}) => {
  return useQuery({
    queryKey: ["courts", courtId],
    queryFn: () => getCourtByIdApi(courtId),
    staleTime: 60 * 1000,
    ...options,
    enabled: !!courtId && (options.enabled ?? true),
  });
};

// Mutation: ask the venue's box for preview pictures (silent — best effort)
export const useRequestCourtPreview = () => {
  return useMutation({
    mutationFn: requestCourtPreviewApi,
  });
};

// Mutation: Create court
export const useCreateCourt = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createCourtApi,
    onSuccess: () => {
      toast.success("Court created successfully");
      queryClient.invalidateQueries({ queryKey: ["courts"] });
      queryClient.invalidateQueries({ queryKey: ["venues"] }); // courtCount
      queryClient.invalidateQueries({ queryKey: ["clips", "options"] });
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || "Failed to create court");
    },
  });
};

// Mutation: Update court
export const useUpdateCourt = () => {
  const queryClient = useQueryClient();

  return useMutation({
    // `successMessage` lets each court-page section say what it saved
    mutationFn: ({ courtId, courtData }) => updateCourtApi(courtId, courtData),
    onSuccess: (_data, variables) => {
      toast.success(variables?.successMessage || "Court updated successfully");
      queryClient.invalidateQueries({ queryKey: ["courts"] });
      queryClient.invalidateQueries({ queryKey: ["clips", "options"] });
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || "Failed to update court");
    },
  });
};

// Mutation: Issue a new QR code (printed signs with the old one stop working)
export const useRotateCourtQr = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: rotateCourtQrApi,
    onSuccess: (response) => {
      toast.success(
        response?.message || "New QR code issued — reprint this court's sign",
      );
      queryClient.invalidateQueries({ queryKey: ["courts"] });
    },
    onError: (error) => {
      toast.error(
        error.response?.data?.message || "Failed to issue a new QR code",
      );
    },
  });
};

// Mutation: Delete court
export const useDeleteCourt = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteCourtApi,
    onSuccess: () => {
      toast.success("Court deleted successfully");
      queryClient.invalidateQueries({ queryKey: ["courts"] });
      queryClient.invalidateQueries({ queryKey: ["venues"] }); // courtCount
      queryClient.invalidateQueries({ queryKey: ["clips", "options"] });
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || "Failed to delete court");
    },
  });
};
