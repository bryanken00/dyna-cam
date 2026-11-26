import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { KeyRound, Loader2, PlugZap, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

import PasswordInput from "../../../../../components/PasswordInput";
import SectionLabel from "../../../../../components/SectionLabel";
import { useDiscardGuard } from "../../../../../hooks/useDiscardGuard";
import { useSaveCompanyPayments } from "../../../../../services/requests/admin/companyPayments";

// Mirrors company-payments.validator.js
const schema = z.object({
  secretKey: z
    .string()
    .trim()
    .min(20, "Paste the whole secret key")
    .refine(
      (v) => v.startsWith("xnd_development_") || v.startsWith("xnd_production_"),
      "A Xendit secret key starts with xnd_development_ or xnd_production_",
    ),
  callbackToken: z.string().trim().min(10, "Paste the whole webhook verification token"),
});

const EMPTY = { secretKey: "", callbackToken: "" };

/**
 * PLAN-008 phase C: connect (or replace) the company's own Xendit account. Both
 * values are secrets — never shown again after saving.
 */
const OnlinePaymentFormDrawer = ({ open, onClose, onSuccess, entity = null }) => {
  const form = useForm({ resolver: zodResolver(schema), defaultValues: EMPTY });
  const {
    formState: { isDirty, isSubmitSuccessful },
  } = form;
  const saveMutation = useSaveCompanyPayments();
  const { reset: resetSave } = saveMutation;
  // Xendit's refusal (a wrong key), shown in the drawer
  const serverError = saveMutation.error
    ? saveMutation.error.response?.data?.message || "Couldn't connect Xendit. Please try again."
    : "";

  useEffect(() => {
    if (!open) return;
    form.reset(EMPTY);
    resetSave();
  }, [open, form, resetSave]);

  const handleClose = () => {
    form.reset(EMPTY);
    onClose();
  };

  const { guardedClose, markSaved } = useDiscardGuard({
    open,
    isDirty,
    isSubmitSuccessful,
    noun: "Xendit keys",
    onClose: handleClose,
    label: "OnlinePaymentFormDrawer",
  });

  const onSubmit = async (values) => {
    try {
      await saveMutation.mutateAsync(values);
      markSaved();
      onSuccess?.();
    } catch {
      // shown under the fields (serverError)
    }
  };

  const replacing = entity?.source === "company";
  const openCheckouts = entity?.openCheckouts || 0;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) guardedClose();
      }}
    >
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full gap-0 p-0 sm:max-w-140"
        style={{ background: "var(--color-surface)" }}
      >
        <SheetTitle className="sr-only">Connect Xendit</SheetTitle>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} autoComplete="off" className="flex h-full flex-col">
            <div className="flex-1 overflow-y-auto p-6">
              <div className="flex items-start justify-between gap-3 mb-7">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="inline-flex items-center justify-center w-11 h-11 rounded-xl shrink-0 bg-(image:--gradient-primary)">
                    <PlugZap className="w-5.5 h-5.5 text-white" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="m-0 font-semibold leading-tight" style={{ fontSize: 19, color: "var(--color-text-dark)" }}>
                      {replacing ? "Replace Xendit keys" : "Connect Xendit"}
                    </h2>
                    <p className="m-0 mt-0.5" style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                      Players pay straight into your company&apos;s Xendit account.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={guardedClose}
                  aria-label="Close"
                  className="inline-flex items-center justify-center shrink-0 transition-colors hover:bg-(--color-surface-sunken)"
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    border: "1px solid var(--color-line)",
                    color: "var(--color-text-secondary)",
                  }}
                >
                  <X className="w-4.5 h-4.5" />
                </button>
              </div>

              <SectionLabel>From your Xendit dashboard</SectionLabel>
              <p className="m-0 mb-4" style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                Settings → API keys: create a <b>secret key</b> with write access to Invoices and Refunds. Settings →
                Webhooks: copy the <b>verification token</b>. Test keys (xnd_development_…) take test payments only.
              </p>

              <FormField
                control={form.control}
                name="secretKey"
                render={({ field }) => (
                  <FormItem className="mb-5">
                    <FormLabel>
                      Secret key <span style={{ color: "var(--color-error)" }}>*</span>
                    </FormLabel>
                    <FormControl>
                      <PasswordInput placeholder="xnd_production_…" autoComplete="off" {...field} />
                    </FormControl>
                    <FormDescription>Stored encrypted — nobody can read it back, not even you.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="callbackToken"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Webhook verification token <span style={{ color: "var(--color-error)" }}>*</span>
                    </FormLabel>
                    <FormControl>
                      <PasswordInput placeholder="From Settings → Webhooks" autoComplete="off" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {replacing && openCheckouts > 0 && (
                <p className="m-0 mt-5" style={{ fontSize: 13, color: "var(--color-warning)" }}>
                  {openCheckouts} unpaid checkout{openCheckouts === 1 ? " is" : "s are"} still open with the old keys —
                  they can&apos;t be paid after you replace them, and their holds just run out.
                </p>
              )}
              {serverError && (
                <p className="m-0 mt-5" style={{ fontSize: 13, color: "var(--color-error)" }}>
                  {serverError}
                </p>
              )}
            </div>

            <div
              className="flex justify-end gap-3 p-6 pt-5"
              style={{
                borderTop: "1px solid var(--color-line)",
                paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))",
              }}
            >
              <Button type="button" variant="outline" size="lg" onClick={guardedClose}>
                Cancel
              </Button>
              <Button type="submit" size="lg" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? <Loader2 className="animate-spin" /> : <KeyRound />}
                {replacing ? "Replace keys" : "Connect"}
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
};

export default OnlinePaymentFormDrawer;
