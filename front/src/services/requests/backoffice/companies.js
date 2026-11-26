import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  createCompanyApi,
  getCompaniesApi,
  getCompanyApi,
  reactivateCompanyApi,
  resetOwnerPasswordApi,
  suspendCompanyApi,
  updateCompanyApi,
} from "../../api/backoffice/companies";

/** PLAN-008 phase B: companies in the back office. Keys: ["backoffice", "companies", …]. */

// Query: a page of companies → data.companies, data.stats, data.pagination
export const useGetCompanies = (params) =>
  useQuery({
    queryKey: ["backoffice", "companies", "list", params],
    queryFn: () => getCompaniesApi(params),
    placeholderData: keepPreviousData,
  });

// Query: one company → data.company
export const useGetCompany = (companyId) =>
  useQuery({
    queryKey: ["backoffice", "companies", "detail", companyId],
    queryFn: () => getCompanyApi(companyId),
    enabled: !!companyId,
  });

const useCompanyMutation = (mutationFn, { success, failure }) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (response) => {
      if (success) toast.success(typeof success === "function" ? success(response) : success);
      queryClient.invalidateQueries({ queryKey: ["backoffice", "companies"] });
      queryClient.invalidateQueries({ queryKey: ["backoffice", "activity"] });
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || failure);
    },
  });
};

// Mutation: onboard → data.owner.temporaryPassword (shown once by the page)
export const useCreateCompany = () =>
  useCompanyMutation(createCompanyApi, { success: "Company onboarded", failure: "Failed to onboard the company" });

export const useUpdateCompany = () =>
  useCompanyMutation(updateCompanyApi, { success: "Company updated", failure: "Failed to update the company" });

export const useSuspendCompany = () =>
  useCompanyMutation(suspendCompanyApi, { success: "Company suspended", failure: "Failed to suspend the company" });

export const useReactivateCompany = () =>
  useCompanyMutation(reactivateCompanyApi, {
    success: "Company reactivated",
    failure: "Failed to reactivate the company",
  });

// Mutation: → data.owner.temporaryPassword (shown once by the page)
export const useResetOwnerPassword = () =>
  useCompanyMutation(resetOwnerPasswordApi, {
    success: "The Owner's password was reset",
    failure: "Failed to reset the Owner's password",
  });
