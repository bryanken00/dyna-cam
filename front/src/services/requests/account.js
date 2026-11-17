import { useMutation } from "@tanstack/react-query";
import {
  forgotPasswordApi,
  resetPasswordApi,
  updateProfileApi,
  changePasswordApi,
} from "../api/account";

export const useForgotPassword = () =>
  useMutation({ mutationFn: forgotPasswordApi });

export const useResetPassword = () =>
  useMutation({ mutationFn: resetPasswordApi });

export const useUpdateProfile = () =>
  useMutation({ mutationFn: updateProfileApi });

export const useChangePassword = () =>
  useMutation({ mutationFn: changePasswordApi });
