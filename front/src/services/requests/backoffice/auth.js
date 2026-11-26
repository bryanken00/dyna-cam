import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useBackofficeAuthStore } from "../../../store/backofficeStore";
import { useCsrfStore } from "../../../store/csrfStore";
import {
  changeBackofficePasswordApi,
  getBackofficeCsrfTokenApi,
  getBackofficeMeApi,
  loginBackofficeApi,
  logoutBackofficeApi,
} from "../../api/backoffice/auth";

/** PLAN-008 phase B: sign in to the back office (the page shows errors itself). */
export const useLoginBackoffice = () =>
  useMutation({
    mutationFn: loginBackofficeApi,
    onSuccess: (response) => {
      const { token, refreshToken, admin } = response.data;
      useBackofficeAuthStore.getState().setSession({
        token,
        refreshToken: refreshToken?.token || null,
        userData: admin,
      });
      getBackofficeCsrfTokenApi()
        .then((res) => useCsrfStore.getState().setCsrfToken(res.data?.csrfToken || res.csrfToken))
        .catch(() => {});
    },
  });

export const useLogoutBackoffice = () =>
  useMutation({
    mutationFn: logoutBackofficeApi,
    // Signed out here whatever the server says (an expired token is no session)
    onSettled: () => {
      useBackofficeAuthStore.getState().reset();
      useCsrfStore.getState().clearCsrfToken?.();
    },
  });

// Query: the signed-in super admin → data.admin
export const useGetBackofficeMe = (options = {}) =>
  useQuery({
    queryKey: ["backoffice", "me"],
    queryFn: getBackofficeMeApi,
    staleTime: 5 * 60 * 1000,
    ...options,
  });

/** Change the password; the reply is a new session for this device. */
export const useChangeBackofficePassword = () =>
  useMutation({
    mutationFn: changeBackofficePasswordApi,
    onSuccess: (response) => {
      const { token, refreshToken, admin } = response.data;
      useBackofficeAuthStore.getState().setSession({
        token,
        refreshToken: refreshToken?.token || null,
        userData: admin,
      });
      toast.success("Password changed");
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || "Failed to change the password");
    },
  });
