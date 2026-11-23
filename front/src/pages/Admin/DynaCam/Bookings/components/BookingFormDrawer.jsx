import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { CalendarPlus, Loader2, Mail, Phone, Plus, User, X } from "lucide-react";

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

import DatePicker from "../../../../../components/DatePicker";
import SectionLabel from "../../../../../components/SectionLabel";
import StatusToggle from "../../../../../components/StatusToggle";
import { useDiscardGuard } from "../../../../../hooks/useDiscardGuard";
import { usePermissions } from "../../../../../hooks/usePermissions";
import { decodeHTML } from "../../../../../utils/decode-html";
import {
  PHONE_MAX_LENGTH,
  PHONE_PLACEHOLDER,
  formatPhoneOnChange,
  zPhone,
} from "../../../../../utils/phoneFormat";
import {
  START_HOURS,
  formatHour,
  formatPeso,
  formatTimeRange,
} from "../../../../../utils/dynaCam";
import {
  useCreateBooking,
  useGetBookingQuote,
} from "../../../../../services/requests/admin/bookings";

const LENGTHS = [60, 120, 180, 240, 300, 360];

// Mirrors bookings.validator.js (createBookingSchema)
const bookingSchema = z.object({
  courtId: z.string().min(1, "Pick a court"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  startTime: z.string().regex(/^\d{2}:00$/, "Pick a start time"),
  durationMinutes: z.string(),
  playerName: z.string().trim().min(1, "Name is required").max(100, "Name must not exceed 100 characters"),
  phone: zPhone,
  email: z
    .string()
    .trim()
    .max(255, "Email must not exceed 255 characters")
    .refine((v) => v === "" || z.string().email().safeParse(v).success, "Enter a valid email"),
  payment: z.enum(["Cash", "Hold", "Free"]),
  note: z.string().trim().max(255, "Keep the note under 255 characters"),
  ignoreHours: z.boolean(),
});

const emptyValues = (entity, canTakeCash) => ({
  courtId: entity?.courtId || "",
  date: entity?.date || "",
  startTime: entity?.startTime || "",
  durationMinutes: "60",
  playerName: "",
  phone: "",
  email: "",
  payment: canTakeCash ? "Cash" : "Hold",
  note: "",
  ignoreHours: false,
});

/**
 * PLAN-003: a desk booking (walk-in, phone call). entity = { venueId, courts,
 * courtId?, date, startTime? } — prefilled from the day grid. Shows the price
 * and whether the slot is free as it's filled in.
 */
const BookingFormDrawer = ({ open, onClose, onSuccess, entity = null }) => {
  const req = <span style={{ color: "var(--color-error)" }}>*</span>;
  const { hasPermission } = usePermissions();
  // Taking cash is a payment — it needs the payments permission too
  const canTakeCash = hasPermission("payments", null, "write");
  const courts = entity?.courts || [];

  const form = useForm({
    resolver: zodResolver(bookingSchema),
    defaultValues: emptyValues(null, canTakeCash),
  });
  const {
    formState: { isDirty, isSubmitSuccessful },
  } = form;
  const [courtId, date, startTime, durationMinutes, payment, ignoreHours] = useWatch({
    control: form.control,
    name: ["courtId", "date", "startTime", "durationMinutes", "payment", "ignoreHours"],
  });

  useEffect(() => {
    if (!open) return;
    form.reset(emptyValues(entity, canTakeCash));
  }, [open, entity, canTakeCash, form]);

  const { data: quoteData, isFetching: quoteFetching } = useGetBookingQuote(
    open ? { courtId, date, startTime, durationMinutes } : null,
  );
  const q = quoteData?.data?.quote || null;
  const blocked = !!q && (!!q.conflict || q.hasPassed || (q.outsideHours && !ignoreHours));

  const createMutation = useCreateBooking();
  const isPending = createMutation.isPending;

  const handleClose = () => {
    form.reset(emptyValues(null, canTakeCash));
    onClose();
  };

  const { guardedClose, markSaved } = useDiscardGuard({
    open,
    isDirty,
    isSubmitSuccessful,
    noun: "booking",
    onClose: handleClose,
    label: "BookingFormDrawer",
  });

  const onSubmit = async (values) => {
    try {
      const result = await createMutation.mutateAsync({
        courtId: values.courtId,
        date: values.date,
        startTime: values.startTime,
        durationMinutes: Number(values.durationMinutes),
        playerName: values.playerName,
        phone: values.phone || null,
        email: values.email || null,
        payment: values.payment,
        note: values.payment === "Cash" ? values.note || null : null,
        ignoreHours: values.ignoreHours,
      });
      markSaved();
      onSuccess?.(result?.data);
    } catch (error) {
      // mutation errors already surface a toast via onError
      console.error("Form submission error:", error);
    }
  };

  const paymentOptions = [
    ...(canTakeCash ? [{ v: "Cash", label: "Paid now (cash)" }] : []),
    { v: "Hold", label: "Pay at the desk later" },
    { v: "Free", label: "Free" },
  ];

  const priceLine = () => {
    if (!q) return quoteFetching ? "Checking the slot…" : "Pick a court, date and time to see the price.";
    if (q.conflict) return q.conflict;
    if (q.hasPassed) return "That time has already passed.";
    if (!q.bookable) {
      return `No price is set for ${formatHour(q.noRateAt.slice(11, 16))} — book it as Free, or add a rate in the venue's booking settings.`;
    }
    return null;
  };
  const problem = priceLine();

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
        <SheetTitle className="sr-only">New Booking</SheetTitle>

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
                    <CalendarPlus className="w-5.5 h-5.5 text-white" />
                  </span>
                  <div className="min-w-0">
                    <h2
                      className="m-0 font-semibold leading-tight"
                      style={{ fontSize: 19, color: "var(--color-text-dark)" }}
                    >
                      New Booking
                    </h2>
                    <p
                      className="m-0 mt-0.5"
                      style={{ fontSize: 13, color: "var(--color-text-secondary)" }}
                    >
                      Book a court for a walk-in or a phone call
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

              {/* When */}
              <SectionLabel>Court and time</SectionLabel>
              <div className="grid gap-5 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="courtId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Court {req}</FormLabel>
                      <Select value={field.value || undefined} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="h-10 w-full">
                            <SelectValue placeholder="Pick a court" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
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
                <FormField
                  control={form.control}
                  name="date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date {req}</FormLabel>
                      <FormControl>
                        <DatePicker {...field} allowClear={false} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="startTime"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Starts {req}</FormLabel>
                      <Select value={field.value || undefined} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="h-10 w-full">
                            <SelectValue placeholder="Pick a time" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {START_HOURS.map((h) => (
                            <SelectItem key={h} value={h}>
                              {formatHour(h)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="durationMinutes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Length {req}</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="h-10 w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {LENGTHS.map((m) => (
                            <SelectItem key={m} value={String(m)}>
                              {m / 60} {m === 60 ? "hour" : "hours"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Price + availability */}
              <div
                className="mt-5 px-4 py-3.5 flex items-center justify-between gap-3 flex-wrap"
                style={{
                  border: "1px solid var(--color-line)",
                  borderRadius: 12,
                  background: "var(--color-surface-sunken)",
                }}
              >
                {problem ? (
                  <span
                    style={{
                      fontSize: 13.5,
                      color: q && (q.conflict || q.hasPassed) ? "var(--color-error)" : "var(--color-text-secondary)",
                    }}
                  >
                    {problem}
                  </span>
                ) : (
                  <>
                    <span style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}>
                      {formatTimeRange(q.startAt, q.endAt)}
                    </span>
                    <span style={{ fontSize: 18, fontWeight: 600, color: "var(--color-text-dark)" }}>
                      {formatPeso(q.price)}
                    </span>
                  </>
                )}
              </div>

              {q?.outsideHours && !q.conflict && (
                <FormField
                  control={form.control}
                  name="ignoreHours"
                  render={({ field }) => (
                    <FormItem className="mt-3 flex items-start gap-2.5">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={(v) => field.onChange(v === true)}
                        />
                      </FormControl>
                      <div>
                        <FormLabel className="m-0">Book outside opening hours</FormLabel>
                        <FormDescription>
                          This time is outside the venue&apos;s opening hours. Tick to book it anyway.
                        </FormDescription>
                      </div>
                    </FormItem>
                  )}
                />
              )}

              {/* Who */}
              <div className="mt-7">
                <SectionLabel>Player</SectionLabel>
                <FormField
                  control={form.control}
                  name="playerName"
                  render={({ field }) => (
                    <FormItem className="mb-5">
                      <FormLabel>Name {req}</FormLabel>
                      <div className="relative">
                        <User
                          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
                          style={{ color: "var(--color-text-muted)" }}
                        />
                        <FormControl>
                          <Input placeholder="e.g., Ana Reyes" className="h-10 pl-9" maxLength={100} {...field} />
                        </FormControl>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid gap-5 sm:grid-cols-2">
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
                              onChange={(e) => field.onChange(formatPhoneOnChange(e.target.value))}
                            />
                          </FormControl>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <div className="relative">
                          <Mail
                            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
                            style={{ color: "var(--color-text-muted)" }}
                          />
                          <FormControl>
                            <Input
                              type="email"
                              placeholder="e.g., ana@example.com"
                              className="h-10 pl-9"
                              maxLength={255}
                              {...field}
                            />
                          </FormControl>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              {/* Payment */}
              <div className="mt-7">
                <SectionLabel>Payment</SectionLabel>
                <FormField
                  control={form.control}
                  name="payment"
                  render={({ field }) => (
                    <FormItem>
                      <StatusToggle value={field.value} onChange={field.onChange} options={paymentOptions} />
                      <FormDescription>
                        {field.value === "Cash" &&
                          "Take the cash now — the booking is confirmed and the payment is recorded."}
                        {field.value === "Hold" &&
                          "The slot is held until shortly before it starts; it's released if not paid by then."}
                        {field.value === "Free" && "No payment — the booking is confirmed."}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {payment === "Cash" && (
                  <FormField
                    control={form.control}
                    name="note"
                    render={({ field }) => (
                      <FormItem className="mt-5">
                        <FormLabel>Payment note</FormLabel>
                        <FormControl>
                          <Input placeholder="Optional, e.g. paid by Juan" className="h-10" maxLength={255} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
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
              <Button type="submit" size="lg" disabled={isPending || blocked}>
                {isPending ? <Loader2 className="animate-spin" /> : <Plus />}
                {payment === "Cash" && q?.bookable && !blocked
                  ? `Book and take ${formatPeso(q.price)}`
                  : "Book court"}
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
};

export default BookingFormDrawer;
