import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { CalendarCog, Loader2, Plus, Save, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

import SectionLabel from "../../../../../components/SectionLabel";
import { useDiscardGuard } from "../../../../../hooks/useDiscardGuard";
import { decodeHTML } from "../../../../../utils/decode-html";
import {
  END_HOURS,
  START_HOURS,
  WEEKDAY_NAMES,
  WEEKDAY_SHORT,
  WEEK_ORDER,
  formatHour,
} from "../../../../../utils/dynaCam";
import { useUpdateBookingSettings } from "../../../../../services/requests/admin/bookingSettings";

// "all" stands for "every court" — Radix Select items can't be ""
const ALL_COURTS = "all";

const hourOf = (hhmm) => Number(String(hhmm).slice(0, 2));

const wholeNumber = (label, min, max) =>
  z
    .string()
    .trim()
    .regex(/^\d+$/, `${label}: enter a whole number`)
    .refine((v) => Number(v) >= min, `${label}: at least ${min}`)
    .refine((v) => Number(v) <= max, `${label}: at most ${max}`);

// Mirrors booking-settings.validator.js
const settingsSchema = z
  .object({
    bookingDaysAhead: wholeNumber("Days ahead", 1, 90),
    deskHoldMinutes: wholeNumber("Pay-link deadline", 0, 1440),
    onlineHoldMinutes: wholeNumber("Online payment hold", 5, 60),
    cancelCutoffHours: wholeNumber("Cancel cut-off", 0, 168),
    checkInEarlyMinutes: wholeNumber("Early check-in", 0, 60),
    hours: z.array(
      z
        .object({
          dayOfWeek: z.number(),
          open: z.boolean(),
          opensAt: z.string(),
          closesAt: z.string(),
        })
        .refine((h) => !h.open || hourOf(h.opensAt) < hourOf(h.closesAt), {
          message: "Closes before it opens",
          path: ["closesAt"],
        }),
    ),
    rates: z.array(
      z
        .object({
          rateId: z.string(),
          name: z.string().trim().min(1, "Name the rate, e.g. Peak").max(50),
          courtId: z.string(),
          daysOfWeek: z.array(z.number()).min(1, "Pick at least one day"),
          startTime: z.string(),
          endTime: z.string(),
          pricePerHour: z
            .string()
            .trim()
            .regex(/^\d+(\.\d{1,2})?$/, "Enter an amount like 450 or 449.50")
            .refine((v) => Number(v) <= 1000000, "The price is too high"),
        })
        .refine((r) => hourOf(r.startTime) < hourOf(r.endTime), {
          message: "Ends before it starts",
          path: ["endTime"],
        }),
    ),
  })
  .superRefine((values, ctx) => {
    const { rates } = values;
    for (let i = 0; i < rates.length; i += 1) {
      for (let j = i + 1; j < rates.length; j += 1) {
        const a = rates[i];
        const b = rates[j];
        if (a.courtId !== b.courtId) continue;
        const sharedDay = a.daysOfWeek.some((d) => b.daysOfWeek.includes(d));
        const sharedHours =
          hourOf(a.startTime) < hourOf(b.endTime) &&
          hourOf(b.startTime) < hourOf(a.endTime);
        if (sharedDay && sharedHours) {
          ctx.addIssue({
            code: "custom",
            path: ["rates", j, "name"],
            message: `Overlaps "${a.name || "another rate"}" on the same day and hours`,
          });
          return;
        }
      }
    }
  });

const NEW_RATE = {
  rateId: "",
  name: "",
  courtId: ALL_COURTS,
  daysOfWeek: [1, 2, 3, 4, 5],
  startTime: "06:00",
  endTime: "17:00",
  pricePerHour: "",
};

/** Settings from the API → form values (Monday-first week, strings for inputs). */
const toFormValues = (settings) => {
  const byDay = new Map((settings?.hours || []).map((h) => [h.dayOfWeek, h]));
  return {
    bookingDaysAhead: String(settings?.bookingDaysAhead ?? 14),
    deskHoldMinutes: String(settings?.deskHoldMinutes ?? 30),
    onlineHoldMinutes: String(settings?.onlineHoldMinutes ?? 15),
    cancelCutoffHours: String(settings?.cancelCutoffHours ?? 24),
    checkInEarlyMinutes: String(settings?.checkInEarlyMinutes ?? 10),
    hours: WEEK_ORDER.map((dayOfWeek) => {
      const h = byDay.get(dayOfWeek);
      return {
        dayOfWeek,
        open: !!h,
        opensAt: h?.opensAt ?? "06:00",
        closesAt: h?.closesAt ?? "22:00",
      };
    }),
    rates: (settings?.rates || []).map((r) => ({
      rateId: r.rateId,
      name: decodeHTML(r.name) ?? "",
      courtId: r.courtId || ALL_COURTS,
      daysOfWeek: r.daysOfWeek,
      startTime: r.startTime,
      endTime: r.endTime,
      pricePerHour: String(r.pricePerHour),
    })),
  };
};

const HourSelect = ({ value, onChange, options, disabled, label }) => (
  <Select value={value} onValueChange={onChange} disabled={disabled}>
    <SelectTrigger className="h-10 w-full" aria-label={label}>
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      {options.map((h) => (
        <SelectItem key={h} value={h}>
          {formatHour(h)}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

const NumberField = ({ form, name, label, description, suffix }) => (
  <FormField
    control={form.control}
    name={name}
    render={({ field }) => (
      <FormItem>
        <FormLabel>{label}</FormLabel>
        <div className="flex items-center gap-2">
          <FormControl>
            <Input
              type="number"
              inputMode="numeric"
              step={1}
              className="h-10 max-w-28"
              {...field}
            />
          </FormControl>
          <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
            {suffix}
          </span>
        </div>
        {description && <FormDescription>{description}</FormDescription>}
        <FormMessage />
      </FormItem>
    )}
  />
);

/** Seven day toggles; value is an array of dayOfWeek numbers. */
const DayPicker = ({ value = [], onChange }) => (
  <div className="flex flex-wrap gap-1.5">
    {WEEK_ORDER.map((day) => {
      const on = value.includes(day);
      return (
        <button
          key={day}
          type="button"
          aria-pressed={on}
          aria-label={WEEKDAY_NAMES[day]}
          onClick={() =>
            onChange(on ? value.filter((d) => d !== day) : [...value, day])
          }
          className="transition-colors"
          style={{
            minWidth: 44,
            height: 34,
            padding: "0 8px",
            borderRadius: 8,
            fontSize: 12.5,
            fontWeight: 500,
            border: `1px solid ${on ? "var(--color-text-dark)" : "var(--color-line)"}`,
            background: on ? "var(--color-surface-sunken)" : "var(--color-surface)",
            color: on ? "var(--color-text-dark)" : "var(--color-text-muted)",
          }}
        >
          {WEEKDAY_SHORT[day]}
        </button>
      );
    })}
  </div>
);

/**
 * A venue's booking setup in one form: rules, weekly opening hours and the
 * hourly rates. entity = { settings, courts } from GET /booking-settings/:venueId.
 */
const BookingSettingsFormDrawer = ({ open, onClose, onSuccess, entity = null }) => {
  const settings = entity?.settings || null;
  const courts = entity?.courts || [];

  const form = useForm({
    resolver: zodResolver(settingsSchema),
    defaultValues: toFormValues(null),
  });
  const {
    formState: { isDirty, isSubmitSuccessful },
  } = form;
  const { fields: rateFields, append, remove } = useFieldArray({
    control: form.control,
    name: "rates",
    keyName: "fieldKey",
  });
  const hours = useWatch({ control: form.control, name: "hours" });

  useEffect(() => {
    if (!open) return;
    form.reset(toFormValues(settings));
  }, [open, settings, form]);

  const updateMutation = useUpdateBookingSettings();
  const isPending = updateMutation.isPending;
  const saveDisabled = !isDirty;

  const handleClose = () => {
    form.reset(toFormValues(settings));
    onClose();
  };

  const { guardedClose, markSaved } = useDiscardGuard({
    open,
    isDirty,
    isSubmitSuccessful,
    noun: "booking settings",
    onClose: handleClose,
    label: "BookingSettingsFormDrawer",
  });

  const onSubmit = async (values) => {
    try {
      await updateMutation.mutateAsync({
        venueId: settings.venueId,
        settings: {
          bookingDaysAhead: Number(values.bookingDaysAhead),
          deskHoldMinutes: Number(values.deskHoldMinutes),
          onlineHoldMinutes: Number(values.onlineHoldMinutes),
          cancelCutoffHours: Number(values.cancelCutoffHours),
          checkInEarlyMinutes: Number(values.checkInEarlyMinutes),
          hours: values.hours
            .filter((h) => h.open)
            .map(({ dayOfWeek, opensAt, closesAt }) => ({ dayOfWeek, opensAt, closesAt })),
          rates: values.rates.map((r) => ({
            rateId: r.rateId || null,
            name: r.name,
            courtId: r.courtId === ALL_COURTS ? null : r.courtId,
            daysOfWeek: r.daysOfWeek,
            startTime: r.startTime,
            endTime: r.endTime,
            pricePerHour: Number(r.pricePerHour),
          })),
        },
      });
      markSaved();
      onSuccess?.();
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
        <SheetTitle className="sr-only">Edit booking settings</SheetTitle>

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
                    <CalendarCog className="w-5.5 h-5.5 text-white" />
                  </span>
                  <div className="min-w-0">
                    <h2
                      className="m-0 font-semibold leading-tight"
                      style={{ fontSize: 19, color: "var(--color-text-dark)" }}
                    >
                      Booking settings
                    </h2>
                    <p
                      className="m-0 mt-0.5"
                      style={{ fontSize: 13, color: "var(--color-text-secondary)" }}
                    >
                      Rules, opening hours and prices for{" "}
                      {decodeHTML(settings?.venueName) || "this venue"}
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

              {/* Rules */}
              <SectionLabel>Booking rules</SectionLabel>
              <div className="grid gap-5 sm:grid-cols-2">
                <NumberField
                  form={form}
                  name="bookingDaysAhead"
                  label="Book up to"
                  suffix="days ahead"
                />
                <NumberField
                  form={form}
                  name="deskHoldMinutes"
                  label="Pay-link deadline"
                  suffix="min before the start"
                  description="A booking staff make with a pay link is held until then, and released if it isn't paid online. (No payment at the counter.)"
                />
                <NumberField
                  form={form}
                  name="onlineHoldMinutes"
                  label="Online payment hold"
                  suffix="min"
                  description="How long a checkout holds the slot (5–60)."
                />
                <NumberField
                  form={form}
                  name="cancelCutoffHours"
                  label="Players can cancel or move until"
                  suffix="hours before the start"
                  description="Full refund before this; after it, players call the desk."
                />
                <NumberField
                  form={form}
                  name="checkInEarlyMinutes"
                  label="Check in from"
                  suffix="min before the start"
                />
              </div>

              {/* Opening hours */}
              <div className="mt-8">
                <SectionLabel>Opening hours</SectionLabel>
                <p className="m-0 mb-3" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
                  Bookings fit inside these hours. Untick a day to close it.
                </p>
                <div className="space-y-2">
                  {WEEK_ORDER.map((day, index) => {
                    const isOpen = hours?.[index]?.open;
                    return (
                      <div
                        key={day}
                        className="grid items-center gap-3"
                        style={{ gridTemplateColumns: "minmax(120px, 1fr) 2fr 2fr" }}
                      >
                        <FormField
                          control={form.control}
                          name={`hours.${index}.open`}
                          render={({ field }) => (
                            <FormItem className="flex items-center gap-2.5">
                              <FormControl>
                                <Checkbox
                                  checked={field.value}
                                  onCheckedChange={(v) => field.onChange(v === true)}
                                  aria-label={`Open on ${WEEKDAY_NAMES[day]}`}
                                />
                              </FormControl>
                              <FormLabel className="m-0 font-normal">
                                {WEEKDAY_NAMES[day]}
                              </FormLabel>
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`hours.${index}.opensAt`}
                          render={({ field }) => (
                            <FormItem>
                              <HourSelect
                                value={field.value}
                                onChange={field.onChange}
                                options={START_HOURS}
                                disabled={!isOpen}
                                label={`${WEEKDAY_NAMES[day]} opens`}
                              />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`hours.${index}.closesAt`}
                          render={({ field }) => (
                            <FormItem>
                              <HourSelect
                                value={field.value}
                                onChange={field.onChange}
                                options={END_HOURS}
                                disabled={!isOpen}
                                label={`${WEEKDAY_NAMES[day]} closes`}
                              />
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Rates */}
              <div className="mt-8">
                <SectionLabel>Prices per hour</SectionLabel>
                <p className="m-0 mb-3" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
                  Each booked hour costs the rate that covers it. A court&apos;s own rate beats
                  an all-courts one. Open hours with no rate can&apos;t be booked online.
                </p>

                <div className="space-y-3">
                  {rateFields.map((rate, index) => (
                    <div
                      key={rate.fieldKey}
                      className="p-4 space-y-4"
                      style={{ border: "1px solid var(--color-line)", borderRadius: 12 }}
                    >
                      <div className="grid gap-4 sm:grid-cols-2">
                        <FormField
                          control={form.control}
                          name={`rates.${index}.name`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>
                                Name <span style={{ color: "var(--color-error)" }}>*</span>
                              </FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="e.g., Peak"
                                  className="h-10"
                                  maxLength={50}
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`rates.${index}.courtId`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Courts</FormLabel>
                              <Select value={field.value} onValueChange={field.onChange}>
                                <FormControl>
                                  <SelectTrigger className="h-10 w-full">
                                    <SelectValue />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value={ALL_COURTS}>All courts</SelectItem>
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
                      </div>

                      <FormField
                        control={form.control}
                        name={`rates.${index}.daysOfWeek`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Days</FormLabel>
                            <DayPicker value={field.value} onChange={field.onChange} />
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <div className="grid gap-4 sm:grid-cols-3 items-start">
                        <FormField
                          control={form.control}
                          name={`rates.${index}.startTime`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>From</FormLabel>
                              <HourSelect
                                value={field.value}
                                onChange={field.onChange}
                                options={START_HOURS}
                                label="Rate starts"
                              />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`rates.${index}.endTime`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Until</FormLabel>
                              <HourSelect
                                value={field.value}
                                onChange={field.onChange}
                                options={END_HOURS}
                                label="Rate ends"
                              />
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`rates.${index}.pricePerHour`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>
                                ₱ per hour <span style={{ color: "var(--color-error)" }}>*</span>
                              </FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  inputMode="decimal"
                                  min={0}
                                  step="0.01"
                                  className="h-10"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <div className="flex justify-end">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => remove(index)}
                        >
                          <Trash2 />
                          Remove rate
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>

                <Button
                  type="button"
                  variant="outline"
                  className="mt-3"
                  onClick={() => append({ ...NEW_RATE })}
                >
                  <Plus />
                  Add rate
                </Button>
              </div>
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
                    <Button type="submit" size="lg" disabled={saveDisabled || isPending}>
                      {isPending ? <Loader2 className="animate-spin" /> : <Save />}
                      Save settings
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

export default BookingSettingsFormDrawer;
