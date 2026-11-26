import { useEffect, useId, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";
import {
  Banknote,
  CalendarClock,
  ImageUp,
  Loader2,
  MapPin,
  Navigation,
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

import SearchableSelect from "../../../../../components/SearchableSelect";
import SectionLabel from "../../../../../components/SectionLabel";
import VenueLocationPicker from "../../../../../components/VenueLocationPicker";
import StatusToggle from "../../../../../components/StatusToggle";
import { useDiscardGuard } from "../../../../../hooks/useDiscardGuard";
import { decodeHTML } from "../../../../../utils/decode-html";
import {
  buildAddress,
  cityOptions,
  loadBarangays,
  loadPsgc,
  provinceOptions,
  regionOptions,
} from "../../../../../utils/psgc";
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

// CR-050: a coordinate typed or set by the pin — "" = none
const coordinate = (label, limit) =>
  z
    .string()
    .trim()
    .refine((v) => v === "" || (Number.isFinite(Number(v)) && Math.abs(Number(v)) <= limit), {
      message: `${label} must be a number between -${limit} and ${limit}`,
    });

// Mirrors venues.validator.js: name required (≤100), address/phone/logo
// optional (NULL columns), retention 1–365 whole days (CR-017: 1 by default).
// CR-050: the address is picked region → province → city → barangay (+ street);
// `address` holds an older venue's typed address until a region is picked.
const venueSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(100, "Name must not exceed 100 characters"),
  address: z.string().max(255, "Address must not exceed 255 characters"),
  regionCode: z.string(),
  provinceCode: z.string(),
  cityMunCode: z.string(),
  barangayCode: z.string(),
  street: z.string().max(120, "Street must not exceed 120 characters"),
  latitude: coordinate("Latitude", 90),
  longitude: coordinate("Longitude", 180),
  phone: zPhone,
  logoUrl: z.string(),
  clipRetentionDays: z
    .string()
    .trim()
    .regex(/^\d+$/, "Enter a whole number of days")
    .refine((v) => Number(v) >= 1, "Keep videos for at least 1 day")
    .refine((v) => Number(v) <= 365, "Keep videos for at most 365 days"),
  // Pesos, at most 2 decimals; 0 = clips are free
  clipPrice: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Enter an amount like 50 or 49.50")
    .refine((v) => Number(v) <= 100000, "The price is too high"),
  status: z.enum(["Active", "Inactive"]),
}).superRefine((v, ctx) => {
  // Once a region is picked, the rest of the address is needed down to the barangay
  if (v.regionCode) {
    const missing = [
      ["provinceCode", "Pick the province"],
      ["cityMunCode", "Pick the city or municipality"],
      ["barangayCode", "Pick the barangay"],
    ].find(([key]) => !v[key]);
    if (missing) ctx.addIssue({ code: "custom", path: [missing[0]], message: missing[1] });
  }
  if ((v.latitude === "") !== (v.longitude === "")) {
    ctx.addIssue({ code: "custom", path: ["latitude"], message: "Set both, or clear the pin" });
  }
});

const EMPTY = {
  name: "",
  address: "",
  regionCode: "",
  provinceCode: "",
  cityMunCode: "",
  barangayCode: "",
  street: "",
  latitude: "",
  longitude: "",
  phone: "",
  logoUrl: "",
  clipRetentionDays: "7",
  clipPrice: "0",
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

  // ─── CR-050: the address lists and the pin ──────────────────────────
  const [regionCode, provinceCode, cityMunCode, barangayCode, street, latitude, longitude, legacyAddress] =
    useWatch({
      control: form.control,
      name: ["regionCode", "provinceCode", "cityMunCode", "barangayCode", "street", "latitude", "longitude", "address"],
    });
  const { data: psgc } = useQuery({
    queryKey: ["psgc"],
    queryFn: loadPsgc,
    staleTime: Infinity,
    enabled: open,
  });
  const { data: barangays = [], isFetching: barangaysLoading } = useQuery({
    queryKey: ["psgc", "barangays", cityMunCode],
    queryFn: () => loadBarangays(cityMunCode),
    staleTime: Infinity,
    enabled: open && !!cityMunCode,
  });
  const regions = useMemo(() => regionOptions(psgc), [psgc]);
  const provinces = useMemo(() => provinceOptions(psgc, regionCode), [psgc, regionCode]);
  const cities = useMemo(() => cityOptions(psgc, provinceCode), [psgc, provinceCode]);
  const labelOf = (list, code) => list.find((o) => o.value === code)?.label || "";
  const picked = {
    province: labelOf(provinces, provinceCode),
    city: labelOf(cities, cityMunCode),
    barangay: labelOf(barangays, barangayCode),
  };
  const builtAddress = buildAddress({ street, ...picked });
  // Where the map goes while there's no pin (the most precise level picked)
  const focusQuery = [picked.barangay, picked.city, picked.province].filter(Boolean).join(", ");
  const focusZoom = picked.barangay ? 16 : picked.city ? 14 : 11;

  /** A level changed: the levels under it no longer fit. */
  const pickLevel = (key, value) => {
    const below = { regionCode: ["provinceCode", "cityMunCode", "barangayCode"], provinceCode: ["cityMunCode", "barangayCode"], cityMunCode: ["barangayCode"] };
    form.setValue(key, value, { shouldDirty: true, shouldValidate: true });
    for (const child of below[key] || []) form.setValue(child, "", { shouldDirty: true });
  };
  const setPin = (lat, lng) => {
    form.setValue("latitude", lat === null ? "" : String(lat), { shouldDirty: true, shouldValidate: true });
    form.setValue("longitude", lng === null ? "" : String(lng), { shouldDirty: true, shouldValidate: true });
  };

  // Hydrate on open; map fields explicitly (API responses carry extra keys).
  useEffect(() => {
    if (!open) return;
    form.reset(
      entity
        ? {
            name: decodeHTML(entity.name) ?? "",
            address: decodeHTML(entity.address) ?? "",
            regionCode: entity.regionCode ?? "",
            provinceCode: entity.provinceCode ?? "",
            cityMunCode: entity.cityMunCode ?? "",
            barangayCode: entity.barangayCode ?? "",
            street: decodeHTML(entity.street) ?? "",
            latitude: entity.latitude === null || entity.latitude === undefined ? "" : String(Number(entity.latitude)),
            longitude: entity.longitude === null || entity.longitude === undefined ? "" : String(Number(entity.longitude)),
            phone: entity.phone ?? "",
            logoUrl: entity.logoUrl ?? "",
            clipRetentionDays: String(entity.clipRetentionDays ?? 7),
            clipPrice: String(Number(entity.clipPrice) || 0),
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
        // CR-050: built from the picked address; an older typed one stays until a region is picked
        address: (values.regionCode ? builtAddress : values.address.trim()) || null,
        regionCode: values.regionCode || null,
        provinceCode: values.provinceCode || null,
        cityMunCode: values.cityMunCode || null,
        barangayCode: values.barangayCode || null,
        street: values.street.trim() || null,
        latitude: values.latitude === "" ? null : Number(values.latitude),
        longitude: values.longitude === "" ? null : Number(values.longitude),
        phone: values.phone || null,
        logoUrl,
        clipRetentionDays: Number(values.clipRetentionDays),
        // Always sent: the API treats a missing price as 0 (free)
        clipPrice: Number(values.clipPrice),
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
                        : "Add a venue that hosts DGSports courts"}
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
              {/* CR-050: the address from the PH address list, then the map pin */}
              <div className="mt-7">
                <SectionLabel>Address</SectionLabel>
                {isEditMode && legacyAddress && !regionCode && (
                  <p className="m-0 mb-3" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
                    Current address: <span style={{ color: "var(--color-text-dark)" }}>{legacyAddress}</span> — pick it
                    below to replace it.
                  </p>
                )}
                <div className="grid items-start gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="regionCode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Region</FormLabel>
                        <FormControl>
                          <SearchableSelect
                            className="h-10 w-full"
                            value={field.value || undefined}
                            onValueChange={(v) => pickLevel("regionCode", v)}
                            options={regions}
                            placeholder="Select region"
                            searchPlaceholder="Type to search…"
                            disabled={!psgc}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="provinceCode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Province</FormLabel>
                        <FormControl>
                          <SearchableSelect
                            className="h-10 w-full"
                            value={field.value || undefined}
                            onValueChange={(v) => pickLevel("provinceCode", v)}
                            options={provinces}
                            placeholder="Select province"
                            searchPlaceholder="Type to search…"
                            disabled={!regionCode}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="cityMunCode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>City / Municipality</FormLabel>
                        <FormControl>
                          <SearchableSelect
                            className="h-10 w-full"
                            value={field.value || undefined}
                            onValueChange={(v) => pickLevel("cityMunCode", v)}
                            options={cities}
                            placeholder="Select city or municipality"
                            searchPlaceholder="Type to search…"
                            disabled={!provinceCode}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="barangayCode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Barangay</FormLabel>
                        <FormControl>
                          <SearchableSelect
                            className="h-10 w-full"
                            value={field.value || undefined}
                            onValueChange={(v) => pickLevel("barangayCode", v)}
                            options={barangays}
                            placeholder="Select barangay"
                            searchPlaceholder="Type to search…"
                            disabled={!cityMunCode || barangaysLoading}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="sm:col-span-2">
                    <FormField
                      control={form.control}
                      name="street"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Street, building (optional)</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g., 12 Rizal Ave" className="h-10" maxLength={120} {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>
                {regionCode && builtAddress && (
                  <p className="m-0 mt-3" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
                    Shown to players as: <span style={{ color: "var(--color-text-dark)" }}>{builtAddress}</span>
                  </p>
                )}
              </div>

              <div className="mt-7">
                <SectionLabel>Map pin</SectionLabel>
                <p className="m-0 mb-3" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
                  <Navigation className="inline w-3.5 h-3.5 mr-1 -mt-0.5" />
                  Players get Google Maps directions to this pin. The map moves to the barangay or city you pick.
                </p>
                <VenueLocationPicker
                  latitude={latitude === "" ? null : Number(latitude)}
                  longitude={longitude === "" ? null : Number(longitude)}
                  onChange={setPin}
                  focusQuery={focusQuery}
                  focusZoom={focusZoom}
                />
                <div className="grid items-start gap-4 sm:grid-cols-2 mt-3">
                  <FormField
                    control={form.control}
                    name="latitude"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Latitude</FormLabel>
                        <FormControl>
                          <Input inputMode="decimal" placeholder="e.g., 14.569231" className="h-10" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="longitude"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Longitude</FormLabel>
                        <FormControl>
                          <Input inputMode="decimal" placeholder="e.g., 121.132411" className="h-10" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

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
                      <FormLabel>Keep videos for (days) {req}</FormLabel>
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
                        Saved replays and game videos are deleted this many
                        days after they&apos;re saved (1–365). Their Google
                        Drive copies go after 2 days.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="clipPrice"
                  render={({ field }) => (
                    <FormItem className="mt-5">
                      <FormLabel>Clip price (₱) {req}</FormLabel>
                      <div className="relative max-w-60">
                        <Banknote
                          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
                          style={{ color: "var(--color-text-muted)" }}
                        />
                        <FormControl>
                          <Input
                            type="number"
                            inputMode="decimal"
                            min={0}
                            step="0.01"
                            className="h-10 pl-9"
                            {...field}
                          />
                        </FormControl>
                      </div>
                      <FormDescription>
                        Players pay this at the front desk to unlock a clip. 0
                        makes clips free. Applies to new clips.
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
