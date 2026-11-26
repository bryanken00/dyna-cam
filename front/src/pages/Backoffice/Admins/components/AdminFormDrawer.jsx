import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Loader2, Mail, Plus, Save, ShieldCheck, User, X } from "lucide-react";

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
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import SectionLabel from "../../../../components/SectionLabel";
import { useDiscardGuard } from "../../../../hooks/useDiscardGuard";
import { useCreateAdmin, useUpdateAdmin } from "../../../../services/requests/backoffice/admins";
import { decodeHTML } from "../../../../utils/decode-html";

// Mirrors backoffice.validator.js (createAdminSchema / updateAdminSchema)
const nameField = (label) => z.string().trim().min(1, `${label} is required`).max(50);
const editSchema = z.object({ firstName: nameField("First name"), lastName: nameField("Last name") });
const createSchema = editSchema.extend({
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email").max(100),
});

const EMPTY = { firstName: "", lastName: "", email: "" };
const req = <span style={{ color: "var(--color-error)" }}>*</span>;
const iconCls = "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2";
const muted = { color: "var(--color-text-muted)" };

/**
 * PLAN-008 phase E: add a super admin (they get a temporary password, shown once)
 * or rename one. Props: `{ open, onClose, onSuccess, entity? }` — onSuccess(response)
 * gets the API reply (adding: data.temporaryPassword).
 */
const AdminFormDrawer = ({ open, onClose, onSuccess, entity = null }) => {
  const isEditMode = !!entity;
  const form = useForm({ resolver: zodResolver(isEditMode ? editSchema : createSchema), defaultValues: EMPTY });
  const {
    formState: { isDirty, isSubmitSuccessful },
  } = form;

  useEffect(() => {
    if (!open) return;
    form.reset(
      entity
        ? { firstName: decodeHTML(entity.firstName) ?? "", lastName: decodeHTML(entity.lastName) ?? "", email: entity.email ?? "" }
        : EMPTY,
    );
  }, [open, entity, form]);

  const createMutation = useCreateAdmin();
  const updateMutation = useUpdateAdmin();
  const isPending = createMutation.isPending || updateMutation.isPending;
  const saveDisabled = isEditMode && !isDirty;

  const handleClose = () => {
    form.reset(EMPTY);
    onClose();
  };
  const { guardedClose, markSaved } = useDiscardGuard({
    open,
    isDirty,
    isSubmitSuccessful,
    noun: "super admin",
    onClose: handleClose,
    label: "AdminFormDrawer",
  });

  const onSubmit = async (values) => {
    try {
      const response = isEditMode
        ? await updateMutation.mutateAsync({
            platformAdminId: entity.platformAdminId,
            data: { firstName: values.firstName, lastName: values.lastName },
          })
        : await createMutation.mutateAsync(values);
      markSaved();
      onSuccess?.(response);
    } catch (error) {
      // the mutation's onError shows a toast
      console.error("Super admin form:", error);
    }
  };

  const textField = (name, label, { icon: Icon, placeholder, type = "text", description, disabled } = {}) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>
            {label} {!disabled && req}
          </FormLabel>
          <div className="relative">
            <Icon className={iconCls} style={muted} />
            <FormControl>
              <Input type={type} placeholder={placeholder} className="h-10 pl-9" disabled={disabled} {...field} />
            </FormControl>
          </div>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <Sheet open={open} onOpenChange={(next) => !next && guardedClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full gap-0 p-0 sm:max-w-140"
        style={{ background: "var(--color-surface)" }}
      >
        <SheetTitle className="sr-only">{isEditMode ? "Edit super admin" : "Add a super admin"}</SheetTitle>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} autoComplete="off" className="flex h-full flex-col">
            <div className="flex-1 overflow-y-auto p-6">
              <div className="flex items-start justify-between gap-3 mb-7">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="inline-flex items-center justify-center w-11 h-11 rounded-xl shrink-0 bg-(image:--gradient-primary)">
                    <ShieldCheck className="w-5.5 h-5.5 text-white" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="m-0 font-semibold leading-tight" style={{ fontSize: 19, color: "var(--color-text-dark)" }}>
                      {isEditMode ? "Edit super admin" : "Add a super admin"}
                    </h2>
                    <p className="m-0 mt-0.5" style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                      {isEditMode ? "Their name" : "Someone at DGSports — they get a temporary password"}
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

              <SectionLabel>Super admin</SectionLabel>
              <div className="grid items-start gap-5 sm:grid-cols-2">
                {textField("firstName", "First name", { icon: User, placeholder: "Juan" })}
                {textField("lastName", "Last name", { icon: User, placeholder: "Dela Cruz" })}
                <div className="sm:col-span-2">
                  {textField("email", "Email (their sign-in)", {
                    icon: Mail,
                    placeholder: "name@dgsports.com",
                    type: "email",
                    disabled: isEditMode,
                    description: isEditMode ? "The email can't change." : "They sign in to the back office with it.",
                  })}
                </div>
              </div>
            </div>

            <div
              className="flex justify-end gap-3 p-6 pt-5"
              style={{ borderTop: "1px solid var(--color-line)", paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}
            >
              <Button type="button" variant="outline" size="lg" onClick={guardedClose}>
                Cancel
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Button type="submit" size="lg" disabled={saveDisabled || isPending}>
                      {isPending ? <Loader2 className="animate-spin" /> : isEditMode ? <Save /> : <Plus />}
                      {isEditMode ? "Save changes" : "Add super admin"}
                    </Button>
                  </span>
                </TooltipTrigger>
                {saveDisabled && <TooltipContent>No changes to save yet</TooltipContent>}
              </Tooltip>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
};

export default AdminFormDrawer;
