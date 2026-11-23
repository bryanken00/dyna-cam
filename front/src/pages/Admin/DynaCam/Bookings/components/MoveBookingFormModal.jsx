import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { CalendarClock, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import DatePicker from "../../../../../components/DatePicker";
import { decodeHTML } from "../../../../../utils/decode-html";
import {
  START_HOURS,
  formatHour,
  formatMinutes,
  formatPeso,
  formatTimeRange,
} from "../../../../../utils/dynaCam";
import {
  useGetBookingQuote,
  useMoveBooking,
} from "../../../../../services/requests/admin/bookings";

// Mirrors moveBookingSchema
const schema = z.object({
  courtId: z.string().min(1, "Pick a court"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  startTime: z.string().regex(/^\d{2}:00$/, "Pick a start time"),
  reprice: z.boolean(),
  ignoreHours: z.boolean(),
});

const toValues = (booking) => ({
  courtId: booking?.courtId || "",
  date: booking?.startAt?.slice(0, 10) || "",
  startTime: booking?.startAt?.slice(11, 16) || "",
  reprice: false,
  ignoreHours: false,
});

/**
 * Move a booking to another time and/or court at its venue, same length. A
 * short form, so a Dialog. Props: `{ open, onClose, onSuccess, booking, courts }`.
 */
const MoveBookingFormModal = ({ open, onClose, onSuccess, booking, courts = [] }) => {
  const form = useForm({ resolver: zodResolver(schema), defaultValues: toValues(null) });
  const moveMutation = useMoveBooking();

  useEffect(() => {
    if (open) form.reset(toValues(booking));
  }, [open, booking, form]);

  const [courtId, date, startTime, reprice, ignoreHours] = useWatch({
    control: form.control,
    name: ["courtId", "date", "startTime", "reprice", "ignoreHours"],
  });
  const unchanged =
    booking &&
    courtId === booking.courtId &&
    `${date} ${startTime}:00` === booking.startAt;

  const { data: quoteData } = useGetBookingQuote(
    open && booking && !unchanged
      ? { courtId, date, startTime, durationMinutes: booking.durationMinutes, bookingId: booking.bookingId }
      : null,
  );
  const q = quoteData?.data?.quote || null;
  const blocked =
    unchanged || (!!q && (!!q.conflict || q.hasPassed || (q.outsideHours && !ignoreHours)));
  const isPaid = booking?.paymentStatus === "Paid";

  const onSubmit = async (values) => {
    try {
      await moveMutation.mutateAsync({ bookingId: booking.bookingId, move: values });
      onSuccess?.();
    } catch (error) {
      // the mutation's onError already surfaced a toast
      console.error("Move booking error:", error);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="sm:max-w-130">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} autoComplete="off" className="space-y-5">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CalendarClock className="w-4.5 h-4.5" />
                Move booking
              </DialogTitle>
              <DialogDescription>
                {booking
                  ? `${decodeHTML(booking.playerName)} · ${formatMinutes(booking.durationMinutes)} · now ${decodeHTML(
                      booking.courtName,
                    )}, ${formatTimeRange(booking.startAt, booking.endAt)}`
                  : null}
              </DialogDescription>
            </DialogHeader>

            <FormField
              control={form.control}
              name="courtId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Court</FormLabel>
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
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date</FormLabel>
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
                    <FormLabel>Starts</FormLabel>
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
            </div>

            {q && !unchanged && (
              <p
                className="m-0"
                style={{
                  fontSize: 13.5,
                  color: q.conflict || q.hasPassed ? "var(--color-error)" : "var(--color-text-secondary)",
                }}
              >
                {q.conflict ||
                  (q.hasPassed && "That time has already passed.") ||
                  (q.bookable
                    ? `${formatTimeRange(q.startAt, q.endAt)} would cost ${formatPeso(q.price)} at today's rates.`
                    : "No price is set for that time.")}
              </p>
            )}

            {q?.outsideHours && !q.conflict && (
              <FormField
                control={form.control}
                name="ignoreHours"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2.5">
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(v === true)} />
                    </FormControl>
                    <FormLabel className="m-0 font-normal">
                      It&apos;s outside opening hours — move it anyway
                    </FormLabel>
                  </FormItem>
                )}
              />
            )}

            {!isPaid && (
              <FormField
                control={form.control}
                name="reprice"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2.5">
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(v === true)} />
                    </FormControl>
                    <FormLabel className="m-0 font-normal">
                      Charge the new time&apos;s price (now {formatPeso(booking?.price)})
                    </FormLabel>
                  </FormItem>
                )}
              />
            )}
            {isPaid && (
              <p className="m-0" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
                It&apos;s paid, so it keeps its price of {formatPeso(booking.price)}.
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={moveMutation.isPending || blocked || (reprice && q && !q.bookable)}
              >
                {moveMutation.isPending ? <Loader2 className="animate-spin" /> : <CalendarClock />}
                Move booking
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default MoveBookingFormModal;
