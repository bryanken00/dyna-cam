import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Loader2, MapPin, Plus, Radio, X } from "lucide-react";

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

import SectionLabel from "../../../../components/SectionLabel";
import StatusToggle from "../../../../components/StatusToggle";
import { useDiscardGuard } from "../../../../hooks/useDiscardGuard";
import { decodeHTML } from "../../../../utils/decode-html";
import { courtUpdatePayload } from "../../../../utils/dynaCam";
import {
  useCreateCourt,
  useUpdateCourt,
} from "../../../../services/requests/admin/courts";

const courtSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(100, "Name must not exceed 100 characters"),
  status: z.enum(["Active", "Inactive"]),
});

const EMPTY = { name: "", status: "Active" };

const iconPrefix =
  "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2";
const mutedIcon = { color: "var(--color-text-muted)" };

/**
 * Add a court to a venue, or rename / (de)activate one. The camera, QR sign,
 * button and live stream are set up on the court's own page.
 *
 * `entity` is an existing court (edit), or `{ venueId, venueName }` — the
 * venue to add a court to (create). On create `onSuccess` receives
 * `{ courtId }` so the page can open the new court's setup.
 */
const CourtFormDrawer = ({ open, onClose, onSuccess, entity = null }) => {
  const isEditMode = !!entity?.courtId;
  const req = <span style={{ color: "var(--color-error)" }}>*</span>;

  const form = useForm({
    resolver: zodResolver(courtSchema),
    defaultValues: EMPTY,
  });
  const {
    formState: { isDirty, isSubmitSuccessful },
  } = form;

  useEffect(() => {
    if (!open) return;
    form.reset(
      isEditMode
        ? {
            name: decodeHTML(entity.name) ?? "",
            status: entity.status === "Inactive" ? "Inactive" : "Active",
          }
        : EMPTY,
    );
  }, [open, entity, isEditMode, form]);

  const createMutation = useCreateCourt();
  const updateMutation = useUpdateCourt();
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
    noun: "court",
    onClose: handleClose,
    label: "CourtFormDrawer",
  });

  const onSubmit = async (values) => {
    try {
      if (isEditMode) {
        // PUT is a full update — keep every other setting as it is
        await updateMutation.mutateAsync({
          courtId: entity.courtId,
          courtData: courtUpdatePayload(entity, {
            name: values.name,
            status: values.status,
          }),
        });
        markSaved();
        onSuccess?.(null);
      } else {
        const response = await createMutation.mutateAsync({
          venueId: entity?.venueId,
          name: values.name,
        });
        markSaved();
        onSuccess?.({ courtId: response?.data?.courtId });
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
          {isEditMode ? "Edit Court" : "Add Court"}
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
                    <Radio className="w-5.5 h-5.5 text-white" />
                  </span>
                  <div className="min-w-0">
                    <h2
                      className="m-0 font-semibold leading-tight"
                      style={{ fontSize: 19, color: "var(--color-text-dark)" }}
                    >
                      {isEditMode ? "Edit Court" : "Add Court"}
                    </h2>
                    <p
                      className="m-0 mt-0.5"
                      style={{
                        fontSize: 13,
                        color: "var(--color-text-secondary)",
                      }}
                    >
                      {isEditMode
                        ? "Rename the court or take it out of use"
                        : "Next you'll set up its camera"}
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

              <SectionLabel>Court details</SectionLabel>

              <FormItem className="mb-5">
                <FormLabel>Venue</FormLabel>
                <div className="relative">
                  <MapPin className={iconPrefix} style={mutedIcon} />
                  <Input
                    value={decodeHTML(entity?.venueName)}
                    disabled
                    readOnly
                    className="h-10 pl-9"
                  />
                </div>
              </FormItem>

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Court name {req}</FormLabel>
                    <div className="relative">
                      <Radio className={iconPrefix} style={mutedIcon} />
                      <FormControl>
                        <Input
                          placeholder="e.g., Court 1"
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

              {isEditMode && (
                <div className="mt-7">
                  <SectionLabel>Court status</SectionLabel>
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
                          While Inactive, the court&apos;s QR code shows as not
                          valid.
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
                      {isEditMode ? "Update Court" : "Add Court"}
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

export default CourtFormDrawer;
