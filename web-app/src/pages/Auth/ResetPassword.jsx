import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";
import { CheckCircle2, Lock } from "lucide-react";
import { NavLink, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import AuthHeading from "../../components/AuthHeading";
import AuthLayout from "../../components/AuthLayout";
import PasswordInput from "../../components/PasswordInput";
import PasswordStrengthIndicator from "../../components/PasswordStrengthIndicator";
import { useResetPassword } from "../../services/requests/account";
import { zStrongPassword } from "../../utils/validation";

const schema = z
  .object({
    password: zStrongPassword(8),
    confirmPassword: z.string().min(1, "Please confirm your new password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    error: "Passwords do not match",
    path: ["confirmPassword"],
  });

const LOGIN_PATH = "/admin";

/**
 * Reset-password page. Reads the single-use token from the ?token= query param.
 */
const ResetPassword = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const { mutate, isPending } = useResetPassword();
  const [done, setDone] = useState(false);
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirmPassword: "" },
  });
  const newPassword = form.watch("password");

  const onSubmit = ({ password }) => {
    mutate(
      { token, password },
      {
        onSuccess: () => setDone(true),
        onError: (error) =>
          toast.error(
            error.response?.data?.message ||
              "This reset link is invalid or has expired.",
          ),
      },
    );
  };

  if (done) {
    return (
      <AuthLayout>
        <AuthHeading
          centered
          icon={CheckCircle2}
          title="Password reset"
          subtitle="Your password has been updated. You can now sign in with your new password."
        />
        <NavLink to={LOGIN_PATH}>
          <Button size="lg" className="mt-6 w-full">
            Back to sign in
          </Button>
        </NavLink>
      </AuthLayout>
    );
  }

  if (!token) {
    return (
      <AuthLayout>
        <AuthHeading
          centered
          title="Invalid reset link"
          subtitle="This link is missing its reset token. Please request a new one."
        />
        <NavLink to={`${LOGIN_PATH}/forgot-password`}>
          <Button size="lg" className="mt-6 w-full">
            Request a new link
          </Button>
        </NavLink>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <AuthHeading
        icon={Lock}
        title="Set a new password"
        subtitle="Choose a strong password you don't use elsewhere."
      />

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>New password</FormLabel>
                <FormControl>
                  <PasswordInput
                    autoComplete="new-password"
                    autoFocus
                    placeholder="Enter new password"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <PasswordStrengthIndicator password={newPassword} />

          <FormField
            control={form.control}
            name="confirmPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Confirm new password</FormLabel>
                <FormControl>
                  <PasswordInput
                    autoComplete="new-password"
                    placeholder="Confirm new password"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={isPending}
          >
            {isPending ? "Resetting..." : "Reset password"}
          </Button>
        </form>
      </Form>

      <div
        className="mt-7 pt-5 flex items-center justify-center"
        style={{ borderTop: "1px solid var(--color-line)" }}
      >
        <NavLink to={LOGIN_PATH}>
          <span
            className="hover:underline"
            style={{ fontSize: 13, color: "var(--color-link)" }}
          >
            Back to sign in
          </span>
        </NavLink>
      </div>
    </AuthLayout>
  );
};

export default ResetPassword;
