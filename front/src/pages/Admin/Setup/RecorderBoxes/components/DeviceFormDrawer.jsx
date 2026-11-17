import { useEffect, useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Info, Loader2, MapPin, Plus, Server, X } from "lucide-react";

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
import { useDiscardGuard } from "../../../../../hooks/useDiscardGuard";
import { decodeHTML } from "../../../../../utils/decode-html";
import {
  useGetDeviceOptions,
  useUpdateDevice,
} from "../../../../../services/requests/admin/devices";
import { useCreatePairingCode } from "../../../../../services/requests/admin/pairing-codes";

// Mirrors devices.validator.js: create { venueId, name }, update { name }.
const buildSchema = (isEditMode) =>
  z.object({
    venueId: isEditMode
      ? z.string()
      : z.string().min(1, "Choose the venue this box records"),
    name: z
      .string()
      .trim()
      .min(1, "Name is required")
      .max(100, "Name must not exceed 100 characters"),
  });

const EMPTY = { venueId: "", name: "" };

const iconPrefix =
  "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2";
const mutedIcon = { color: "var(--color-text-muted)" };

/**
 * Add a recorder box, or rename one. On create, `onSuccess` receives
 * `{ name, token }` so the page can show the one-time token.
 */
const DeviceFormDrawer = ({ open, onClose, onSuccess, entity = null }) => {
  const isEditMode = !!entity;
  const req = <span style={{ color: "var(--color-error)" }}>*</span>;

  const schema = useMemo(() => buildSchema(isEditMode), [isEditMode]);
  const form = useForm({ resolver: zodResolver(schema), defaultValues: EMPTY });
  const {
    formState: { isDirty, isSubmitSuccessful },
  } = form;

  // Same query as the Devices page filter, so it is usually already cached
  const { data: optionsData, isLoading: venuesLoading } = useGetDeviceOptions({
    enabled: open && !isEditMode,
  });
  const venueOptions = useMemo(
    () =>
      (optionsData?.data?.venues || []).map((v) => ({
        value: v.venueId,
        label: decodeHTML(v.name),
        hint: v.status === "Active" ? undefined : v.status,
      })),
    [optionsData],
  );

  useEffect(() => {
    if (!open) return;
    form.reset(
      entity
        ? { venueId: entity.venueId ?? "", name: decodeHTML(entity.name) ?? "" }
        : EMPTY,
    );
  }, [open, entity, form]);

  // A new box pairs itself with a 6-digit key (PLAN-002), no token to copy
  const createMutation = useCreatePairingCode("recorders");
  const updateMutation = useUpdateDevice();
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
    noun: "recorder box",
    onClose: handleClose,
    label: "DeviceFormDrawer",
  });

  const onSubmit = async (values) => {
    try {
      if (isEditMode) {
        await updateMutation.mutateAsync({
          deviceId: entity.deviceId,
          deviceData: { name: values.name },
        });
        markSaved();
        onSuccess?.(null);
      } else {
        const response = await createMutation.mutateAsync({
          venueId: values.venueId,
          name: values.name,
        });
        markSaved();
        onSuccess?.({
          name: values.name,
          venueName: venueOptions.find((o) => o.value === values.venueId)?.label,
          code: response?.data?.code,
        });
      }
    } catch (error) {
      // mutation errors already surface a toast via onError
      console.error("Form submission error:", error);
    }
  };

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
          {isEditMode ? "Rename Recorder Box" : "Add Recorder Box"}
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
                    <Server className="w-5.5 h-5.5 text-white" />
                  </span>
                  <div className="min-w-0">
                    <h2
                      className="m-0 font-semibold leading-tight"
                      style={{ fontSize: 19, color: "var(--color-text-dark)" }}
                    >
                      {isEditMode ? "Rename Recorder Box" : "Add Recorder Box"}
                    </h2>
                    <p
                      className="m-0 mt-0.5"
                      style={{
                        fontSize: 13,
                        color: "var(--color-text-secondary)",
                      }}
                    >
                      {isEditMode
                        ? "Give this box a name staff will recognise"
                        : "The on-site box that records a venue's court cameras"}
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

              <SectionLabel>Box details</SectionLabel>

              {isEditMode ? (
                <FormItem className="mb-5">
                  <FormLabel>Venue</FormLabel>
                  <div className="relative">
                    <MapPin className={iconPrefix} style={mutedIcon} />
                    <Input
                      value={decodeHTML(entity.venueName)}
                      disabled
                      readOnly
                      className="h-10 pl-9"
                    />
                  </div>
                </FormItem>
              ) : (
                <FormField
                  control={form.control}
                  name="venueId"
                  render={({ field }) => (
                    <FormItem className="mb-5">
                      <FormLabel>Venue {req}</FormLabel>
                      <FormControl>
                        <SearchableSelect
                          value={field.value || undefined}
                          onValueChange={field.onChange}
                          options={venueOptions}
                          placeholder={
                            venuesLoading ? "Loading venues…" : "Select venue"
                          }
                          emptyText="No venue matches that."
                        />
                      </FormControl>
                      <FormDescription>
                        The box records every court with a camera at this venue.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Box name {req}</FormLabel>
                    <div className="relative">
                      <Server className={iconPrefix} style={mutedIcon} />
                      <FormControl>
                        <Input
                          placeholder="e.g., Front desk mini PC"
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

              {!isEditMode && (
                <div
                  className="flex items-start gap-2.5 mt-6 px-3.5 py-3"
                  style={{
                    border: "1px solid var(--color-line)",
                    borderRadius: 10,
                    background: "var(--color-surface-sunken)",
                    fontSize: 13,
                    color: "var(--color-text-secondary)",
                  }}
                >
                  <Info className="w-4 h-4 mt-0.5 shrink-0" style={mutedIcon} />
                  <span>
                    Next you&apos;ll get a 6-digit pairing key. Put it in the
                    box&apos;s settings within 10 minutes — the box swaps it for
                    its own sign-in token and appears here.
                  </span>
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
                      {isEditMode ? "Save Name" : "Create pairing key"}
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

export default DeviceFormDrawer;
