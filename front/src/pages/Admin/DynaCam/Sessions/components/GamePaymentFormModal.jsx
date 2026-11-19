import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Banknote, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";

import { decodeHTML } from "../../../../../utils/decode-html";
import { formatPayCode, formatPeso } from "../../../../../utils/dynaCam";
import { useRecordGamePayment } from "../../../../../services/requests/admin/payments";

// Same rules as the API: pesos, not negative, up to 2 decimals
const schema = z.object({
  amount: z
    .string()
    .trim()
    .min(1, "Enter the amount paid")
    .refine(
      (v) => /^\d+(\.\d{1,2})?$/.test(v),
      "Enter an amount like 300 or 350, with up to 2 decimals",
    )
    .refine((v) => Number(v) <= 1000000, "That amount is too large"),
  note: z.string().trim().max(255, "Keep the note under 255 characters"),
});

const EMPTY = { amount: "", note: "" };

/**
 * CR-015 "Record payment" for a game: staff type what the player paid, and
 * the game's videos open on the courtside device and the player's page. A
 * short form, so a Dialog. Props: `{ open, onClose, onSuccess, session }`.
 */
const GamePaymentFormModal = ({ open, onClose, onSuccess, session }) => {
  const form = useForm({ resolver: zodResolver(schema), defaultValues: EMPTY });
  const recordMutation = useRecordGamePayment();

  useEffect(() => {
    if (open) form.reset(EMPTY);
  }, [open, form]);

  const amount = useWatch({ control: form.control, name: "amount" }) ?? "";
  const validAmount = /^\d+(\.\d{1,2})?$/.test(String(amount).trim());

  const onSubmit = async (values) => {
    try {
      await recordMutation.mutateAsync({
        sessionId: session.sessionId,
        amount: values.amount,
        note: values.note,
      });
      onSuccess?.();
    } catch (error) {
      // the mutation's onError already surfaced a toast
      console.error("Record game payment error:", error);
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
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            autoComplete="off"
            className="space-y-5"
          >
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Banknote className="w-4.5 h-4.5" />
                Record payment
              </DialogTitle>
              <DialogDescription>
                {session ? (
                  <>
                    {decodeHTML(session.courtName)} ·{" "}
                    {decodeHTML(session.venueName)}
                    {session.payCode && (
                      <>
                        {" · code "}
                        <span className="font-mono">
                          {formatPayCode(session.payCode)}
                        </span>
                      </>
                    )}
                    . Check the code on the player&apos;s screen, then take the
                    cash.
                  </>
                ) : null}
              </DialogDescription>
            </DialogHeader>

            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount paid (₱)</FormLabel>
                  <FormControl>
                    <Input
                      inputMode="decimal"
                      placeholder="e.g., 300"
                      className="h-11"
                      style={{ fontSize: 17 }}
                      autoFocus
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Note</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Optional, e.g. paid by Juan"
                      className="h-10"
                      maxLength={255}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={recordMutation.isPending}>
                {recordMutation.isPending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Banknote />
                )}
                {validAmount
                  ? `Record ${formatPeso(amount)} cash`
                  : "Record cash"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default GamePaymentFormModal;
