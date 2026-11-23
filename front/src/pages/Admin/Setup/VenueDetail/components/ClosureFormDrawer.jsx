import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { CalendarOff, CircleAlert, Loader2, Plus, Save, X } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import DatePicker from "../../../../../components/DatePicker";
import SectionLabel from "../../../../../components/SectionLabel";
import { useDiscardGuard } from "../../../../../hooks/useDiscardGuard";
import { decodeHTML } from "../../../../../utils/decode-html";
import { formatDate, formatTimeRange } from "../../../../../utils/dynaCam";
import {
  bookingsInTheWay,
  useCreateClosure,
  useUpdateClosure,
} from "../../../../../services/requests/admin/closures";

// "all" = the whole venue — Radix Select items can't be ""
const WHOLE_VENUE = "all";
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

// Mirrors closures.validator.js: window required and in order, reason optional (≤255)
const closureSchema = z
  .object({
    courtId: z.string(),
    startAt: z.string().regex(DATE_TIME, "Pick when the closure starts"),
    endAt: z.string().regex(DATE_TIME, "Pick when the closure ends"),
    reason: z.string().max(255, "Reason must not exceed 255 characters"),
  })
  .refine((v) => v.endAt > v.startAt, {
    message: "The closure must end after it starts",
    path: ["endAt"],
  });

const EMPTY = { courtId: WHOLE_VENUE, startAt: "", endAt: "", reason: "" };

/** "2026-11-24 08:00:00" → "2026-11-24T08:00" (the DatePicker's shape). */
const toPickerValue = (local) => (local ? local.slice(0, 16).replace(" ", "T") : "");

/**
 * Add or edit a closure. entity = { venueId, courts } to add one, or a closure
 * from the list (+ venueId, courts) to edit it. A closure on live bookings is
 * refused with the list; staff can then close anyway and cancel them.
 */
const ClosureFormDrawer = ({ open, onClose, onSuccess, entity = null }) => {
  const isEditMode = !!entity?.closureId;
  const courts = entity?.courts || [];
  const req = <span style={{ color: "var(--color-error)" }}>*</span>;

  const form = useForm({ resolver: zodResolver(closureSchema), defaultValues: EMPTY });
  const {
    formState: { isDirty, isSubmitSuccessful },
  } = form;
  const watched = useWatch({ control: form.control, name: ["courtId", "startAt", "endAt"] });
  const windowKey = watched.join("|");

  // Bookings the API said are in the way, for the window they were found for —
  // a different window may have nothing in the way, so they only show for it
  const [found, setFound] = useState(null);
  const conflicts = found && found.windowKey === windowKey ? found.list : null;

  useEffect(() => {
    if (!open) return;
    form.reset(
      isEditMode
        ? {
            courtId: entity.courtId || WHOLE_VENUE,
            startAt: toPickerValue(entity.startAt),
            endAt: toPickerValue(entity.endAt),
            reason: decodeHTML(entity.reason) ?? "",
          }
        : EMPTY,
    );
  }, [open, entity, isEditMode, form]);

  const createMutation = useCreateClosure();
  const updateMutation = useUpdateClosure();
  const isPending = createMutation.isPending || updateMutation.isPending;
  const saveDisabled = isEditMode && !isDirty;

  const handleClose = () => {
    form.reset(EMPTY);
    setFound(null);
    onClose();
  };

  const { guardedClose, markSaved } = useDiscardGuard({
    open,
    isDirty,
    isSubmitSuccessful,
    noun: "closure",
    onClose: handleClose,
    label: "ClosureFormDrawer",
  });

  const onSubmit = async (values) => {
    const closure = {
      courtId: values.courtId === WHOLE_VENUE ? null : values.courtId,
      startAt: values.startAt,
      endAt: values.endAt,
      reason: values.reason.trim() || null,
      // Second submit after seeing the list = close anyway
      cancelConflicts: !!conflicts?.length,
    };
    try {
      if (isEditMode) {
        await updateMutation.mutateAsync({ closureId: entity.closureId, closure });
      } else {
        await createMutation.mutateAsync({ venueId: entity.venueId, ...closure });
      }
      setFound(null);
      markSaved();
      onSuccess?.();
    } catch (error) {
      const inTheWay = bookingsInTheWay(error);
      if (inTheWay) setFound({ windowKey, list: inTheWay });
      else console.error("Form submission error:", error);
    }
  };

  const submitLabel = conflicts?.length
    ? `Close and cancel ${conflicts.length} ${conflicts.length === 1 ? "booking" : "bookings"}`
    : isEditMode
      ? "Update Closure"
      : "Add Closure";

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
        <SheetTitle className="sr-only">{isEditMode ? "Edit Closure" : "Add Closure"}</SheetTitle>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            autoComplete="off"
            className="flex h-full flex-col"
          >
            <div className="flex-1 overflow-y-auto p-6">
              {/* Header */}
              <div className="flex items-start justify-between gap-3 mb-7">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="inline-flex items-center justify-center w-11 h-11 rounded-xl shrink-0 bg-(image:--gradient-primary)">
                    <CalendarOff className="w-5.5 h-5.5 text-white" />
                  </span>
                  <div className="min-w-0">
                    <h2
                      className="m-0 font-semibold leading-tight"
                      style={{ fontSize: 19, color: "var(--color-text-dark)" }}
                    >
                      {isEditMode ? "Edit Closure" : "Add Closure"}
                    </h2>
                    <p
                      className="m-0 mt-0.5"
                      style={{ fontSize: 13, color: "var(--color-text-secondary)" }}
                    >
                      Nobody can book or play on it while it&apos;s closed
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

              <SectionLabel>What closes</SectionLabel>
              <FormField
                control={form.control}
                name="courtId"
                render={({ field }) => (
                  <FormItem className="mb-5">
                    <FormLabel>Court {req}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="h-10 w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={WHOLE_VENUE}>The whole venue</SelectItem>
                        {courts.map((c) => (
                          <SelectItem key={c.courtId} value={c.courtId}>
                            {decodeHTML(c.name)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid gap-5 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="startAt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>From {req}</FormLabel>
                      <FormControl>
                        <DatePicker showTime {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="endAt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Until {req}</FormLabel>
                      <FormControl>
                        <DatePicker showTime {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <p className="m-0 mt-2" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
                Venue time (Manila).
              </p>

              <div className="mt-7">
                <SectionLabel>Why</SectionLabel>
                <FormField
                  control={form.control}
                  name="reason"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Reason</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g., Resurfacing, Club tournament"
                          className="h-10"
                          maxLength={255}
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        Shown to staff, and to players whose bookings it cancels.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {conflicts?.length > 0 && (
                <Alert variant="destructive" className="mt-7">
                  <CircleAlert />
                  <AlertTitle>
                    {conflicts.length === 1
                      ? "1 booking is in the way"
                      : `${conflicts.length} bookings are in the way`}
                  </AlertTitle>
                  <AlertDescription>
                    <ul className="m-0 mt-1 pl-4 space-y-1">
                      {conflicts.map((c) => (
                        <li key={c.bookingCode}>
                          {decodeHTML(c.courtName)} · {formatDate(c.startAt)},{" "}
                          {formatTimeRange(c.startAt, c.endAt)} ·{" "}
                          {decodeHTML(c.playerName)} ({c.bookingCode}
                          {c.paymentStatus === "Paid" ? ", paid" : ""})
                        </li>
                      ))}
                    </ul>
                    <p className="m-0 mt-2">
                      Closing anyway cancels them and refunds the paid ones in full — hand
                      the cash back to those players.
                    </p>
                  </AlertDescription>
                </Alert>
              )}
            </div>

            {/* Footer */}
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
                    <Button
                      type="submit"
                      size="lg"
                      variant={conflicts?.length ? "destructive" : "default"}
                      disabled={saveDisabled || isPending}
                    >
                      {isPending ? (
                        <Loader2 className="animate-spin" />
                      ) : isEditMode ? (
                        <Save />
                      ) : (
                        <Plus />
                      )}
                      {submitLabel}
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

export default ClosureFormDrawer;
