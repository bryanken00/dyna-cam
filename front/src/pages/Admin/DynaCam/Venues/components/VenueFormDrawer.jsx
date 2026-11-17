import { useEffect, useId, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";
import {
  CalendarClock,
  ImageUp,
  Loader2,
  MapPin,
  Phone,
  Plus,
  Trash2,
  X,
} from "lucide-react";

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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import SectionLabel from "../../../../../components/SectionLabel";
import StatusToggle from "../../../../../components/StatusToggle";
import { useDiscardGuard } from "../../../../../hooks/useDiscardGuard";
import { decodeHTML } from "../../../../../utils/decode-html";
import {
  PHONE_MAX_LENGTH,
  PHONE_PLACEHOLDER,
  formatPhoneOnChange,
  zPhone,
} from "../../../../../utils/phoneFormat";
import {
  fileToBase64,
  getImageUrl,
  validateImageFile,
} from "../../../../../utils/upload";
import {
  useCreateVenue,
  useUpdateVenue,
} from "../../../../../services/requests/admin/venues";
import {
  useDeleteFile,
  useUploadImage,
} from "../../../../../services/requests/upload";

// Mirrors venues.validator.js: name required (≤100), address/phone/logo
// optional (NULL columns), retention 1–365 whole days.
const venueSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(100, "Name must not exceed 100 characters"),
  address: z.string().max(255, "Address must not exceed 255 characters"),
  phone: zPhone,
  logoUrl: z.string(),
  clipRetentionDays: z
    .string()
    .trim()
    .regex(/^\d+$/, "Enter a whole number of days")
    .refine((v) => Number(v) >= 1, "Keep clips for at least 1 day")
    .refine((v) => Number(v) <= 365, "Keep clips for at most 365 days"),
  status: z.enum(["Active", "Inactive"]),
});

const EMPTY = {
  name: "",
  address: "",
  phone: "",
  logoUrl: "",
  clipRetentionDays: "30",
  status: "Active",
};

const VenueFormDrawer = ({ open, onClose, onSuccess, entity = null }) => {
  const isEditMode = !!entity;
  const req = <span style={{ color: "var(--color-error)" }}>*</span>;
  const fileInputId = useId();

  // A newly picked logo is staged here and only uploaded on save.
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);

  const form = useForm({
    resolver: zodResolver(venueSchema),
    defaultValues: EMPTY,
  });
  const {
    formState: { isDirty, isSubmitSuccessful },
  } = form;
  const currentLogo = useWatch({ control: form.control, name: "logoUrl" });

  // Hydrate on open; map fields explicitly (API responses carry extra keys).
  useEffect(() => {
    if (!open) return;
    form.reset(
      entity
        ? {
            name: decodeHTML(entity.name) ?? "",
            address: decodeHTML(entity.address) ?? "",
            phone: entity.phone ?? "",
            logoUrl: entity.logoUrl ?? "",
            clipRetentionDays: String(entity.clipRetentionDays ?? 30),
            status: entity.status === "Inactive" ? "Inactive" : "Active",
          }
        : EMPTY,
    );
  }, [open, entity, form]);

  const createMutation = useCreateVenue();
  const updateMutation = useUpdateVenue();
  const uploadMutation = useUploadImage();
  const deleteFileMutation = useDeleteFile();

  const isPending =
    createMutation.isPending ||
    updateMutation.isPending ||
    uploadMutation.isPending;
  const dirty = isDirty || !!imageFile;
  const saveDisabled = isEditMode && !dirty;

  const clearStagedImage = () => {
    setImageFile(null);
    setImagePreview(null);
  };

  const handleClose = () => {
    form.reset(EMPTY);
    clearStagedImage();
    onClose();
  };

  const { guardedClose, markSaved } = useDiscardGuard({
    open,
    isDirty: dirty,
    isSubmitSuccessful,
    noun: "venue",
    onClose: handleClose,
    label: "VenueFormDrawer",
  });

  const handlePickFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const check = validateImageFile(file, { maxSizeMB: 5 });
    if (!check.valid) {
      toast.error(check.error);
      event.target.value = "";
      return;
    }
    try {
      setImagePreview(await fileToBase64(file));
      setImageFile(file);
    } catch (error) {
      console.error("Logo preview error:", error);
      toast.error("Couldn't read that image");
    }
  };

  const handleRemoveLogo = () => {
    clearStagedImage();
    form.setValue("logoUrl", "", { shouldDirty: true });
  };

  const onSubmit = async (values) => {
    let uploadedUrl = null;
    try {
      // Upload a staged logo first; the API returns its signed link, which is
      // what we save on the venue (the backend reduces it to the stored path).
      if (imageFile) {
        const uploaded = await uploadMutation.mutateAsync(imageFile);
        uploadedUrl = uploaded?.data?.url || null;
      }
      const logoUrl = uploadedUrl || values.logoUrl || null;

      const payload = {
        name: values.name,
        address: values.address.trim() || null,
        phone: values.phone || null,
        logoUrl,
        clipRetentionDays: Number(values.clipRetentionDays),
      };

      if (isEditMode) {
        await updateMutation.mutateAsync({
          venueId: entity.venueId,
          venueData: { ...payload, status: values.status },
        });
        // The old logo is no longer referenced — tidy it up (best effort)
        if (entity.logoUrl && logoUrl !== entity.logoUrl) {
          deleteFileMutation.mutate(entity.logoUrl);
        }
      } else {
        await createMutation.mutateAsync(payload);
      }

      clearStagedImage();
      markSaved();
      onSuccess?.();
    } catch (error) {
      // The save failed after the logo went up — don't leave it orphaned
      if (uploadedUrl) deleteFileMutation.mutate(uploadedUrl);
      // mutation errors already surface a toast via onError
      console.error("Form submission error:", error);
    }
  };

  const logoSrc = imagePreview || getImageUrl(currentLogo);

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
        className="w-full gap-0 p-0 sm:max-w-200"
        style={{ background: "var(--color-surface)" }}
      >
        <SheetTitle className="sr-only">
          {isEditMode ? "Edit Venue" : "Create New Venue"}
        </SheetTitle>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            autoComplete="off"
            className="flex h-full flex-col"
          >
            <div className="flex-1 overflow-y-auto p-6">
              {/* Header — accent chip + title + subtitle + bordered X */}
              <div className="flex items-start justify-between gap-3 mb-7">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="inline-flex items-center justify-center w-11 h-11 rounded-xl shrink-0 bg-(image:--gradient-primary)">
                    <MapPin className="w-5.5 h-5.5 text-white" />
                  </span>
                  <div className="min-w-0">
                    <h2
                      className="m-0 font-semibold leading-tight"
                      style={{ fontSize: 19, color: "var(--color-text-dark)" }}
                    >
                      {isEditMode ? "Edit Venue" : "Create New Venue"}
                    </h2>
                    <p
                      className="m-0 mt-0.5"
                      style={{
                        fontSize: 13,
                        color: "var(--color-text-secondary)",
                      }}
                    >
                      {isEditMode
                        ? "Update venue details and clip settings"
                        : "Add a venue that hosts Dyna Cam courts"}
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

              {/* Venue details */}
              <SectionLabel>Venue details</SectionLabel>

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="mb-5">
                    <FormLabel>Venue name {req}</FormLabel>
                    <div className="relative">
                      <MapPin
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
                        style={{ color: "var(--color-text-muted)" }}
                      />
                      <FormControl>
                        <Input
                          placeholder="e.g., Dink City Pickleball"
                          className="h-10 pl-9"
                          maxLength={100}
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
                name="address"
                render={({ field }) => (
                  <FormItem className="mb-5">
                    <FormLabel>Address</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g., 12 Rizal Ave, Makati City"
                        className="h-10"
                        maxLength={255}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone number</FormLabel>
                    <div className="relative">
                      <Phone
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
                        style={{ color: "var(--color-text-muted)" }}
                      />
                      <FormControl>
                        <Input
                          placeholder={PHONE_PLACEHOLDER}
                          className="h-10 pl-9"
                          maxLength={PHONE_MAX_LENGTH}
                          inputMode="tel"
                          {...field}
                          onChange={(e) =>
                            field.onChange(formatPhoneOnChange(e.target.value))
                          }
                        />
                      </FormControl>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Watermark logo */}
              <div className="mt-7">
                <SectionLabel>Watermark logo</SectionLabel>
                <div className="flex items-center gap-4 flex-wrap">
                  <span
                    className="inline-flex items-center justify-center overflow-hidden shrink-0"
                    style={{
                      width: 88,
                      height: 88,
                      borderRadius: 12,
                      border: "1px solid var(--color-line)",
                      background: "var(--color-surface-sunken)",
                      color: "var(--color-text-muted)",
                    }}
                  >
                    {logoSrc ? (
                      <img
                        src={logoSrc}
                        alt="Venue logo preview"
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <ImageUp className="w-6 h-6" strokeWidth={1.6} />
                    )}
                  </span>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* The label opens the hidden file input — no ref needed */}
                      <Button asChild variant="outline" size="sm">
                        <label htmlFor={fileInputId} className="cursor-pointer">
                          <ImageUp />
                          {logoSrc ? "Replace logo" : "Upload logo"}
                        </label>
                      </Button>
                      {logoSrc && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={handleRemoveLogo}
                        >
                          <Trash2 />
                          Remove
                        </Button>
                      )}
                    </div>
                    <p
                      className="m-0"
                      style={{
                        fontSize: 12.5,
                        color: "var(--color-text-muted)",
                      }}
                    >
                      Shown on every clip and on the court sign. PNG with a
                      transparent background works best · JPG, PNG, GIF or WebP,
                      up to 5 MB.
                    </p>
                  </div>
                  <input
                    id={fileInputId}
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    className="hidden"
                    onChange={handlePickFile}
                    // Clear first so picking the same file again still fires
                    onClick={(e) => {
                      e.currentTarget.value = "";
                    }}
                  />
                </div>
              </div>

              {/* Clips */}
              <div className="mt-7">
                <SectionLabel>Clips</SectionLabel>
                <FormField
                  control={form.control}
                  name="clipRetentionDays"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Keep clips for (days) {req}</FormLabel>
                      <div className="relative max-w-60">
                        <CalendarClock
                          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
                          style={{ color: "var(--color-text-muted)" }}
                        />
                        <FormControl>
                          <Input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={365}
                            step={1}
                            className="h-10 pl-9"
                            {...field}
                          />
                        </FormControl>
                      </div>
                      <FormDescription>
                        Saved clips and their links are removed after this
                        many days (1–365).
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Status — edit only; a new venue starts Active */}
              {isEditMode && (
                <div className="mt-7">
                  <SectionLabel>Venue status</SectionLabel>
                  <FormField
                    control={form.control}
                    name="status"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Status {req}</FormLabel>
                        <StatusToggle
                          value={field.value}
                          onChange={field.onChange}
                        />
                        <FormDescription>
                          While Inactive, its court QR codes show as not valid.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}
            </div>

            {/* Footer — hairline top border; Cancel + inverted primary */}
            <div
              className="flex justify-end gap-3 p-6 pt-5"
              style={{
                borderTop: "1px solid var(--color-line)",
                paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))",
              }}
            >
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={guardedClose}
              >
                Cancel
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Button
                      type="submit"
                      size="lg"
                      disabled={saveDisabled || isPending}
                    >
                      {isPending ? <Loader2 className="animate-spin" /> : <Plus />}
                      {isEditMode ? "Update Venue" : "Create Venue"}
                    </Button>
                  </span>
                </TooltipTrigger>
                {saveDisabled && (
                  <TooltipContent>No changes to save yet</TooltipContent>
                )}
              </Tooltip>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
};

export default VenueFormDrawer;
