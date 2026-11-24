import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Ban, Loader2 } from "lucide-react";

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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

import { decodeHTML } from "../../../../../utils/decode-html";
import { formatPeso, formatTimeRange } from "../../../../../utils/dynaCam";
import { useCancelBooking } from "../../../../../services/requests/admin/bookings";

// Mirrors cancelBookingSchema
const schema = z.object({
  reason: z.string().trim().min(1, "Say why it's cancelled").max(255, "Keep it under 255 characters"),
  refund: z.boolean(),
});

/**
 * Cancel a booking (frees the slot). A paid one is refunded in full unless
 * staff untick Refund. Props: `{ open, onClose, onSuccess, booking }`.
 */
const CancelBookingFormModal = ({ open, onClose, onSuccess, booking }) => {
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { reason: "", refund: true } });
  const cancelMutation = useCancelBooking();
  const isPaid = booking?.paymentStatus === "Paid";
  const refund = useWatch({ control: form.control, name: "refund" });

  useEffect(() => {
    if (open) form.reset({ reason: "", refund: true });
  }, [open, form]);

  const onSubmit = async (values) => {
    try {
      await cancelMutation.mutateAsync({
        bookingId: booking.bookingId,
        cancel: { reason: values.reason, refund: isPaid ? values.refund : false },
      });
      onSuccess?.();
    } catch (error) {
      // the mutation's onError already surfaced a toast
      console.error("Cancel booking error:", error);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="sm:max-w-115">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} autoComplete="off" className="space-y-5">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Ban className="w-4.5 h-4.5" />
                Cancel booking
              </DialogTitle>
              <DialogDescription>
                {booking
                  ? `${decodeHTML(booking.playerName)} · ${decodeHTML(booking.courtName)}, ${formatTimeRange(
                      booking.startAt,
                      booking.endAt,
                    )}. The slot is freed for someone else.`
                  : null}
              </DialogDescription>
            </DialogHeader>

            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Reason <span style={{ color: "var(--color-error)" }}>*</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g., Player called to cancel"
                      className="h-10"
                      maxLength={255}
                      autoFocus
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {isPaid && (
              <FormField
                control={form.control}
                name="refund"
                render={({ field }) => (
                  <FormItem className="flex items-start gap-2.5">
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(v === true)} />
                    </FormControl>
                    <div>
                      <FormLabel className="m-0">Refund {formatPeso(booking.price)}</FormLabel>
                      <FormDescription>
                        Give the cash back to the player. Untick to keep it (e.g. a late cancel).
                      </FormDescription>
                    </div>
                  </FormItem>
                )}
              />
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Keep booking
              </Button>
              <Button type="submit" variant="destructive" disabled={cancelMutation.isPending}>
                {cancelMutation.isPending ? <Loader2 className="animate-spin" /> : <Ban />}
                {isPaid && refund ? "Cancel and refund" : "Cancel booking"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default CancelBookingFormModal;
