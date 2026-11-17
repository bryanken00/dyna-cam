import { toast } from "sonner";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  getVenuesApi,
  getVenueByIdApi,
  createVenueApi,
  updateVenueApi,
  deleteVenueApi,
} from "../../api/admin/venues";

// Query: Get all venues
export const useGetVenues = (filters = {}, options = {}) => {
  return useQuery({
    queryKey: ["venues", filters],
    queryFn: () => getVenuesApi(filters),
    staleTime: 5 * 60 * 1000, // 5 minutes
    placeholderData: keepPreviousData,
    ...options,
  });
};

// Query: Get single venue
export const useGetVenueById = (venueId, options = {}) => {
  return useQuery({
    queryKey: ["venues", venueId],
    queryFn: () => getVenueByIdApi(venueId),
    staleTime: 10 * 60 * 1000, // 10 minutes
    ...options,
    enabled: !!venueId && (options.enabled ?? true),
  });
};

// Mutation: Create venue
export const useCreateVenue = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createVenueApi,
    onSuccess: () => {
      toast.success("Venue created successfully");
      queryClient.invalidateQueries({ queryKey: ["venues"] });
      // The Courts / Devices / Clips venue pickers
      queryClient.invalidateQueries({ queryKey: ["courts", "options"] });
      queryClient.invalidateQueries({ queryKey: ["devices", "options"] });
      queryClient.invalidateQueries({ queryKey: ["clips", "options"] });
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || "Failed to create venue");
    },
  });
};

// Mutation: Update venue
export const useUpdateVenue = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ venueId, venueData }) => updateVenueApi(venueId, venueData),
    onSuccess: () => {
      toast.success("Venue updated successfully");
      queryClient.invalidateQueries({ queryKey: ["venues"] });
      // Courts, boxes and clips show the venue's name
      queryClient.invalidateQueries({ queryKey: ["courts"] });
      queryClient.invalidateQueries({ queryKey: ["devices"] });
      queryClient.invalidateQueries({ queryKey: ["clips"] });
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || "Failed to update venue");
    },
  });
};

// Mutation: Delete venue — also retires its courts and revokes its boxes
export const useDeleteVenue = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteVenueApi,
    onSuccess: () => {
      toast.success("Venue deleted successfully");
      queryClient.invalidateQueries({ queryKey: ["venues"] });
      queryClient.invalidateQueries({ queryKey: ["courts"] });
      queryClient.invalidateQueries({ queryKey: ["devices"] });
      queryClient.invalidateQueries({ queryKey: ["clips", "options"] });
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || "Failed to delete venue");
    },
  });
};
