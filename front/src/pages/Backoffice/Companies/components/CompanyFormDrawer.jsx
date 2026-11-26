import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Building2, Link2, Loader2, Mail, Phone, Plus, Save, User, X } from "lucide-react";

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
import { useCreateCompany, useUpdateCompany } from "../../../../services/requests/backoffice/companies";
import { decodeHTML } from "../../../../utils/decode-html";
import { formatPhoneDisplay, formatPhoneOnChange, PHONE_PLACEHOLDER, zPhone } from "../../../../utils/phoneFormat";

// Mirrors backoffice.validator.js — the link is optional (made from the name)
const isSlug = (v) =>
  v === "" || (/^[a-z0-9-]+$/.test(v) && !v.startsWith("-") && !v.endsWith("-") && !v.includes("--"));

const companyFields = {
  name: z.string().trim().min(1, "Name the company").max(100),
  slug: z
    .string()
    .trim()
    .max(60, "Keep the link at most 60 characters")
    .refine(isSlug, "Lowercase letters, numbers and single dashes, e.g. bigpickle-inc"),
  contactEmail: z
    .string()
    .trim()
    .max(100)
    .refine((v) => v === "" || z.email().safeParse(v).success, "Enter a valid email"),
  contactPhone: zPhone,
};

const createSchema = z.object({
  ...companyFields,
  ownerFirstName: z.string().trim().min(1, "Owner's first name is required").max(50),
  ownerLastName: z.string().trim().min(1, "Owner's last name is required").max(50),
  ownerEmail: z.string().trim().min(1, "Owner's email is required").email("Enter a valid email").max(100),
});
const editSchema = z.object(companyFields);

const EMPTY = {
  name: "",
  slug: "",
  contactEmail: "",
  contactPhone: "",
  ownerFirstName: "",
  ownerLastName: "",
  ownerEmail: "",
};

const req = <span style={{ color: "var(--color-error)" }}>*</span>;
const iconCls = "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2";
const muted = { color: "var(--color-text-muted)" };

/** The link the API makes from the name when none is typed (utils/companies.js slugify). */
const slugFromName = (value) =>
  String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

/**
 * PLAN-008 phase B: onboard a company (its details + its Owner) or edit one's
 * details. Props: `{ open, onClose, onSuccess, entity? }` — onSuccess(response)
 * gets the API reply (onboarding: data.owner.temporaryPassword, shown once).
 */
const CompanyFormDrawer = ({ open, onClose, onSuccess, entity = null }) => {
  const isEditMode = !!entity;
  const form = useForm({
    resolver: zodResolver(isEditMode ? editSchema : createSchema),
    defaultValues: EMPTY,
  });
  const {
    formState: { isDirty, isSubmitSuccessful },
  } = form;

  useEffect(() => {
    if (!open) return;
    form.reset(
      entity
        ? {
            ...EMPTY,
            name: decodeHTML(entity.name) ?? "",
            slug: entity.slug ?? "",
            contactEmail: entity.contactEmail ?? "",
            contactPhone: entity.contactPhone ? formatPhoneDisplay(entity.contactPhone) : "",
          }
        : EMPTY,
    );
  }, [open, entity, form]);

  const createMutation = useCreateCompany();
  const updateMutation = useUpdateCompany();
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
    noun: "company",
    onClose: handleClose,
    label: "CompanyFormDrawer",
  });

  const onSubmit = async (values) => {
    const details = {
      name: values.name,
      slug: values.slug || undefined,
      contactEmail: values.contactEmail || null,
      contactPhone: values.contactPhone || null,
    };
    try {
      const response = isEditMode
        ? await updateMutation.mutateAsync({ companyId: entity.companyId, data: details })
        : await createMutation.mutateAsync({
            ...details,
            owner: {
              firstName: values.ownerFirstName,
              lastName: values.ownerLastName,
              email: values.ownerEmail,
            },
          });
      markSaved();
      onSuccess?.(response);
    } catch (error) {
      // the mutation's onError shows a toast
      console.error("Company form:", error);
    }
  };

  // The company link left empty is made from the name — show which one
  const nameValue = useWatch({ control: form.control, name: "name" });
  const slugPreview = slugFromName(nameValue) || "bigpickle-inc";

  const textField = (name, label, { icon: Icon, placeholder, required, type = "text", description, disabled } = {}) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>
            {label} {required && req}
          </FormLabel>
          <div className="relative">
            {Icon && <Icon className={iconCls} style={muted} />}
            <FormControl>
              <Input
                type={type}
                placeholder={placeholder}
                className={`h-10 ${Icon ? "pl-9" : ""}`}
                disabled={disabled}
                {...field}
              />
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
        className="w-full gap-0 p-0 sm:max-w-200"
        style={{ background: "var(--color-surface)" }}
      >
        <SheetTitle className="sr-only">{isEditMode ? "Edit company" : "Onboard a company"}</SheetTitle>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} autoComplete="off" className="flex h-full flex-col">
            <div className="flex-1 overflow-y-auto p-6">
              <div className="flex items-start justify-between gap-3 mb-7">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="inline-flex items-center justify-center w-11 h-11 rounded-xl shrink-0 bg-(image:--gradient-primary)">
                    <Building2 className="w-5.5 h-5.5 text-white" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="m-0 font-semibold leading-tight" style={{ fontSize: 19, color: "var(--color-text-dark)" }}>
                      {isEditMode ? "Edit company" : "Onboard a company"}
                    </h2>
                    <p className="m-0 mt-0.5" style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                      {isEditMode
                        ? "Its name, link and contact"
                        : "The company and its Owner — they get a temporary password"}
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

              <SectionLabel>Company</SectionLabel>
              <div className="grid items-start gap-5 sm:grid-cols-2">
                {textField("name", "Company name", { icon: Building2, placeholder: "e.g., BigPickle Inc.", required: true })}
                {textField("slug", "Company link", {
                  icon: Link2,
                  placeholder: slugPreview,
                  description: "Lowercase letters, numbers and dashes. Left empty, it's made from the name.",
                  disabled: entity?.isDefault,
                })}
                {textField("contactEmail", "Contact email", { icon: Mail, placeholder: "hello@company.com", type: "email" })}
                <FormField
                  control={form.control}
                  name="contactPhone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact phone</FormLabel>
                      <div className="relative">
                        <Phone className={iconCls} style={muted} />
                        <FormControl>
                          <Input
                            inputMode="tel"
                            placeholder={PHONE_PLACEHOLDER}
                            className="h-10 pl-9"
                            {...field}
                            onChange={(e) => field.onChange(formatPhoneOnChange(e.target.value))}
                          />
                        </FormControl>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {!isEditMode && (
                <div className="mt-8">
                  <SectionLabel>Owner</SectionLabel>
                  <p className="m-0 mb-4" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
                    The company&apos;s first account. It holds every permission and adds the venues and staff.
                  </p>
                  <div className="grid items-start gap-5 sm:grid-cols-2">
                    {textField("ownerFirstName", "First name", { icon: User, placeholder: "Juan", required: true })}
                    {textField("ownerLastName", "Last name", { icon: User, placeholder: "Dela Cruz", required: true })}
                    <div className="sm:col-span-2">
                      {textField("ownerEmail", "Email (their sign-in)", {
                        icon: Mail,
                        placeholder: "owner@company.com",
                        type: "email",
                        required: true,
                        description: "One email = one company: it can't already be a staff account.",
                      })}
                    </div>
                  </div>
                </div>
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
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Button type="submit" size="lg" disabled={saveDisabled || isPending}>
                      {isPending ? <Loader2 className="animate-spin" /> : isEditMode ? <Save /> : <Plus />}
                      {isEditMode ? "Save changes" : "Onboard company"}
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

export default CompanyFormDrawer;
