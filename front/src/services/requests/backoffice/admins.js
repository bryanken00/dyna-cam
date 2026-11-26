import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  createAdminApi,
  deactivateAdminApi,
  getAdminsApi,
  reactivateAdminApi,
  resetAdminPasswordApi,
  updateAdminApi,
} from "../../api/backoffice/admins";

/** PLAN-008 phase E: super admins. Keys: ["backoffice", "admins", …]. */

// Query: every super admin → data.admins
export const useGetAdmins = (params = {}) =>
  useQuery({
    queryKey: ["backoffice", "admins", params],
    queryFn: () => getAdminsApi(params),
  });

const useAdminMutation = (mutationFn, { success, failure }) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      if (success) toast.success(success);
      queryClient.invalidateQueries({ queryKey: ["backoffice", "admins"] });
      queryClient.invalidateQueries({ queryKey: ["backoffice", "activity"] });
    },
    onError: (error) => toast.error(error.response?.data?.message || failure),
  });
};

// Mutation: → data.temporaryPassword (shown once by the page)
export const useCreateAdmin = () =>
  useAdminMutation(createAdminApi, { success: "Super admin added", failure: "Failed to add the super admin" });

export const useUpdateAdmin = () =>
  useAdminMutation(updateAdminApi, { success: "Super admin updated", failure: "Failed to update the super admin" });

export const useDeactivateAdmin = () =>
  useAdminMutation(deactivateAdminApi, {
    success: "Super admin deactivated",
    failure: "Failed to deactivate the super admin",
  });

export const useReactivateAdmin = () =>
  useAdminMutation(reactivateAdminApi, {
    success: "Super admin reactivated",
    failure: "Failed to reactivate the super admin",
  });

// Mutation: → data.temporaryPassword (shown once by the page)
export const useResetAdminPassword = () =>
  useAdminMutation(resetAdminPasswordApi, { success: "Password reset", failure: "Failed to reset the password" });
