import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

import PageHeader from "../../../components/PageHeader";
import PasswordInput from "../../../components/PasswordInput";
import PasswordStrengthIndicator from "../../../components/PasswordStrengthIndicator";
import SectionLabel from "../../../components/SectionLabel";
import { useChangeBackofficePassword } from "../../../services/requests/backoffice/auth";
import { useBackofficeAuthStore } from "../../../store/backofficeStore";
import { zStrongPassword } from "../../../utils/validation";

const schema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: zStrongPassword(8),
    confirmPassword: z.string().min(1, "Please confirm your new password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    error: "Passwords do not match",
    path: ["confirmPassword"],
  });

const EMPTY = { currentPassword: "", newPassword: "", confirmPassword: "" };
const req = <span style={{ color: "var(--color-error)" }}>*</span>;

/**
 * PLAN-008 phase B: the super admin's account — change the password. A temporary
 * password (the seeded one) keeps the back office on this page until it's changed.
 */
const BackofficeAccount = () => {
  const mustChange = useBackofficeAuthStore((s) => s.userData?.mustChangePassword);
  const { mutate, isPending } = useChangeBackofficePassword();
  const form = useForm({ resolver: zodResolver(schema), defaultValues: EMPTY });
  const newPassword = useWatch({ control: form.control, name: "newPassword" });

  const onSubmit = (values) => {
    mutate(
      { currentPassword: values.currentPassword, newPassword: values.newPassword },
      { onSuccess: () => form.reset(EMPTY) },
    );
  };

  return (
    <div className="p-4 sm:p-8 space-y-5 max-w-2xl">
      <PageHeader title="Your account" subtitle="Change your back-office password." />

      {mustChange && (
        <Alert>
          <AlertTitle>Choose your own password</AlertTitle>
          <AlertDescription>You signed in with a temporary password. Change it to continue.</AlertDescription>
        </Alert>
      )}

      <div
        className="p-6"
        style={{ background: "var(--color-surface)", border: "1px solid var(--color-line)", borderRadius: "var(--radius-card)" }}
      >
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} autoComplete="off" className="space-y-5">
            <SectionLabel>Password</SectionLabel>
            <FormField
              control={form.control}
              name="currentPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Current password {req}</FormLabel>
                  <FormControl>
                    <PasswordInput autoComplete="current-password" placeholder="Enter current password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="newPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New password {req}</FormLabel>
                  <FormControl>
                    <PasswordInput autoComplete="new-password" placeholder="Enter a new password" {...field} />
                  </FormControl>
                  <PasswordStrengthIndicator password={newPassword} />
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirm new password {req}</FormLabel>
                  <FormControl>
                    <PasswordInput autoComplete="new-password" placeholder="Enter it again" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end">
              <Button type="submit" size="lg" disabled={isPending}>
                {isPending && <Loader2 className="animate-spin" />}
                Change password
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </div>
  );
};

export default BackofficeAccount;
