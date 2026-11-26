import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";
import { Mail, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import AuthHeading from "../../components/AuthHeading";
import AuthLayout from "../../components/AuthLayout";
import PasswordInput from "../../components/PasswordInput";
import { useLoginBackoffice } from "../../services/requests/backoffice/auth";

const schema = z.object({
  email: z.string().trim().min(1, "Please enter your email address").email("Please enter a valid email address"),
  password: z.string().min(1, "Please enter your password"),
});

/** PLAN-008 phase B: the back office's sign-in (DGSports super admins only). */
const BackofficeLogin = () => {
  const { mutate, isPending } = useLoginBackoffice();
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { email: "", password: "" } });

  const onSubmit = (values) => {
    mutate(values, {
      onSuccess: () => form.reset(),
      onError: (error) => toast.error(error.response?.data?.message || "Unable to sign in. Please try again."),
    });
  };

  return (
    <AuthLayout>
      <AuthHeading title="Back office" subtitle="DGSports only — onboard and manage companies." />

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email Address</FormLabel>
                <div className="relative">
                  <Mail
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
                    style={{ color: "var(--color-text-muted)" }}
                  />
                  <FormControl>
                    <Input
                      type="email"
                      autoComplete="username"
                      autoFocus
                      placeholder="Enter your email"
                      className="h-10 pl-9"
                      {...field}
                    />
                  </FormControl>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <PasswordInput autoComplete="current-password" placeholder="Enter your password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" size="lg" className="w-full" disabled={isPending}>
            {isPending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </Form>

      <div
        className="mt-7 pt-5 flex items-center justify-center gap-2"
        style={{ borderTop: "1px solid var(--color-line)" }}
      >
        <Shield className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--color-text-muted)" }} />
        <span style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>Secured back-office access</span>
      </div>
    </AuthLayout>
  );
};

export default BackofficeLogin;
