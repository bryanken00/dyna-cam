import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import {
  Banknote,
  CircleAlert,
  Film,
  Loader2,
  Search,
  Trophy,
} from "lucide-react";

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

import PaymentStatusChip from "../../../../../components/PaymentStatusChip";
import StatusDot from "../../../../../components/StatusDot";
import { decodeHTML } from "../../../../../utils/decode-html";
import { getImageUrl } from "../../../../../utils/upload";
import {
  CLIP_STATUS_TONE,
  PAY_CODE_PATTERN,
  SESSION_STATUS_TONE,
  formatDate,
  formatDateTime,
  formatPayCode,
  formatPeso,
  formatTimeRange,
  normalizePayCode,
} from "../../../../../utils/dynaCam";
import {
  useCreatePayment,
  useLookupPayCode,
} from "../../../../../services/requests/admin/payments";

// The player reads the code out — case and spaces don't matter
const schema = z.object({
  payCode: z
    .string()
    .refine(
      (v) => PAY_CODE_PATTERN.test(normalizePayCode(v)),
      "Enter the code shown on the player's clip or game",
    ),
  // CR-015: a game's amount, typed by staff (checked when recording — clips have a set price)
  amount: z.string().trim(),
  note: z.string().trim().max(255, "Keep the note under 255 characters"),
});

const EMPTY = { payCode: "", amount: "", note: "" };

const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;

/** CR-015: why staff must not take cash for this game, or null when it is payable. */
const gameBlockedReason = (game) => {
  if (game.paymentStatus === "Paid")
    return `This game is already paid${game.paidAmount != null ? ` (${formatPeso(game.paidAmount)})` : ""}.`;
  if (game.paymentStatus === "Free")
    return "This game is free — no payment needed.";
  if (game.status === "Cancelled")
    return "This game was cancelled — don't take payment.";
  if (game.status === "Failed")
    return "This game couldn't be saved — don't take payment.";
  return null;
};

/** "Nov 19 · 1:38 PM – 1:45 PM", "Nov 19 · recording since 1:38 PM", or "waiting for a device". */
const gameWhen = (game) => {
  if (!game.startAt) return "Waiting for a device";
  if (!game.endAt) return `${formatDate(game.startAt)} · recording`;
  return `${formatDate(game.startAt)} · ${formatTimeRange(game.startAt, game.endAt)}`;
};

/** Why staff must not take cash for this clip, or null when it is payable. */
const blockedReason = (clip) => {
  if (clip.paymentStatus === "Paid") return "This clip is already paid.";
  if (clip.paymentStatus === "Free")
    return "This clip is free — no payment needed.";
  if (clip.status === "Failed")
    return "This clip couldn't be saved — don't take payment.";
  if (clip.status === "Expired")
    return "This clip has expired — don't take payment.";
  return null;
};

/**
 * "Take payment": staff type the player's pay code, check the clip it belongs
 * to, then record the cash. CR-015: the code can be a game's (shown on the
 * courtside device and the game's page) — staff then type the amount paid.
 * A short form, so a Dialog (the `XFormModal` variation).
 * Props: `{ open, onClose, onSuccess }`.
 */
const TakePaymentFormModal = ({ open, onClose, onSuccess }) => {
  // The code that was looked up (normalised); "" until staff press Find
  const [lookupCode, setLookupCode] = useState("");

  const form = useForm({ resolver: zodResolver(schema), defaultValues: EMPTY });

  useEffect(() => {
    if (open) form.reset(EMPTY);
  }, [open, form]);

  const {
    data: lookupData,
    isFetching: isLookingUp,
    error: lookupError,
  } = useLookupPayCode(lookupCode);
  const found = lookupCode ? lookupData?.data || null : null;
  const game = found?.kind === "Game" ? found.game : null;
  const clip = found && !game ? found.clip || null : null;
  const amount = useWatch({ control: form.control, name: "amount" }) ?? "";
  const validAmount = AMOUNT_PATTERN.test(String(amount).trim());
  const notFound = lookupError?.response?.status === 404;

  const createMutation = useCreatePayment();

  const handleClose = () => {
    setLookupCode("");
    form.reset(EMPTY);
    onClose();
  };

  // Find — the form's submit (Enter in the code field does the same)
  const onFind = (values) => {
    setLookupCode(normalizePayCode(values.payCode));
  };

  const handleRecord = async () => {
    if (game && !validAmount) {
      form.setError("amount", {
        message: "Enter an amount like 300 or 350, with up to 2 decimals",
      });
      return;
    }
    try {
      await createMutation.mutateAsync(
        game
          ? {
              sessionId: game.sessionId,
              amount: String(amount).trim(),
              note: form.getValues("note") || undefined,
            }
          : { payCode: lookupCode, note: form.getValues("note") || undefined },
      );
      setLookupCode("");
      onSuccess?.();
    } catch (error) {
      // the mutation's onError already surfaced a toast
      console.error("Record payment error:", error);
    }
  };

  const blocked = clip
    ? blockedReason(clip)
    : game
      ? gameBlockedReason(game)
      : null;
  const payable = (clip || game) && !blocked;
  const thumb = getImageUrl(clip?.thumbnailUrl);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose();
      }}
    >
      <DialogContent className="sm:max-w-130">
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onFind)}
            autoComplete="off"
            className="space-y-5"
          >
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Banknote className="w-4.5 h-4.5" />
                Take payment
              </DialogTitle>
              <DialogDescription>
                Ask for the pay code on the player&apos;s clip page or the
                game&apos;s screen, check what it&apos;s for, then take the
                cash.
              </DialogDescription>
            </DialogHeader>

            <FormField
              control={form.control}
              name="payCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Pay code</FormLabel>
                  <div className="flex items-start gap-2">
                    <FormControl>
                      <Input
                        placeholder="e.g., K7Q M2P"
                        className="h-11 font-mono uppercase"
                        style={{ fontSize: 17, letterSpacing: "0.1em" }}
                        maxLength={20}
                        autoCapitalize="characters"
                        spellCheck={false}
                        autoFocus
                        {...field}
                        onChange={(e) => {
                          field.onChange(e.target.value);
                          // A different code needs a fresh lookup
                          if (lookupCode) setLookupCode("");
                        }}
                      />
                    </FormControl>
                    <Button
                      type="submit"
                      variant="outline"
                      className="h-11 shrink-0"
                      disabled={isLookingUp}
                    >
                      {isLookingUp ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <Search />
                      )}
                      Find
                    </Button>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Lookup result */}
            {lookupCode && !isLookingUp && notFound && (
              <div
                role="alert"
                className="flex items-center gap-2.5 px-3.5 py-3"
                style={{
                  border: "1px solid var(--color-line)",
                  borderRadius: 10,
                  fontSize: 13.5,
                  color: "var(--color-text-dark)",
                }}
              >
                <CircleAlert
                  className="w-4 h-4 shrink-0"
                  style={{ color: "var(--color-error)" }}
                />
                No clip or game has that pay code.
              </div>
            )}
            {lookupCode && !isLookingUp && lookupError && !notFound && (
              <p
                className="m-0"
                style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}
              >
                {lookupError.response?.data?.message ||
                  "Couldn't look up that code."}
              </p>
            )}

            {clip && (
              <div
                className="flex gap-3.5 p-3"
                style={{
                  border: "1px solid var(--color-line)",
                  borderRadius: 12,
                  background: "var(--color-surface-sunken)",
                }}
              >
                <span
                  className="shrink-0 overflow-hidden flex items-center justify-center"
                  style={{
                    width: 112,
                    height: 63,
                    borderRadius: 8,
                    border: "1px solid var(--color-line)",
                    background: "var(--color-surface)",
                    color: "var(--color-text-muted)",
                  }}
                >
                  {thumb ? (
                    <img
                      src={thumb}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Film className="w-5 h-5" strokeWidth={1.6} />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div
                    className="truncate font-medium"
                    style={{ fontSize: 14, color: "var(--color-text-dark)" }}
                  >
                    {decodeHTML(clip.courtName)}
                    <span
                      style={{
                        color: "var(--color-text-muted)",
                        fontWeight: 400,
                      }}
                    >
                      {" · "}
                      {decodeHTML(clip.venueName)}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 12.5,
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    {formatDateTime(clip.requestedAt)} · code{" "}
                    <span className="font-mono">
                      {formatPayCode(clip.payCode)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap mt-1.5">
                    <StatusDot tone={CLIP_STATUS_TONE[clip.status] || "muted"}>
                      {clip.status}
                    </StatusDot>
                    <PaymentStatusChip
                      paymentStatus={clip.paymentStatus}
                      price={clip.price}
                    />
                  </div>
                </div>
              </div>
            )}

            {game && (
              <div
                className="flex gap-3.5 p-3"
                style={{
                  border: "1px solid var(--color-line)",
                  borderRadius: 12,
                  background: "var(--color-surface-sunken)",
                }}
              >
                <span
                  className="shrink-0 flex items-center justify-center"
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 10,
                    border: "1px solid var(--color-line)",
                    background: "var(--color-surface)",
                    color: "var(--color-text-dark)",
                  }}
                >
                  <Trophy className="w-5 h-5" strokeWidth={1.8} />
                </span>
                <div className="min-w-0 flex-1">
                  <div
                    className="truncate font-medium"
                    style={{ fontSize: 14, color: "var(--color-text-dark)" }}
                  >
                    Game on {decodeHTML(game.courtName)}
                    <span
                      style={{
                        color: "var(--color-text-muted)",
                        fontWeight: 400,
                      }}
                    >
                      {" · "}
                      {decodeHTML(game.venueName)}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 12.5,
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    {gameWhen(game)} · code{" "}
                    <span className="font-mono">
                      {formatPayCode(game.payCode)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap mt-1.5">
                    <StatusDot
                      tone={SESSION_STATUS_TONE[game.status] || "muted"}
                    >
                      {game.status}
                    </StatusDot>
                    <PaymentStatusChip
                      paymentStatus={game.paymentStatus}
                      price={game.paidAmount}
                    />
                  </div>
                </div>
              </div>
            )}

            {(clip || game) && blocked && (
              <p
                role="alert"
                className="m-0"
                style={{ fontSize: 13.5, color: "var(--color-text-dark)" }}
              >
                {blocked}
              </p>
            )}

            {game && !blocked && (
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
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {payable && (
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
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleClose}>
                {payable ? "Cancel" : "Close"}
              </Button>
              {payable && (
                <Button
                  type="button"
                  onClick={handleRecord}
                  disabled={createMutation.isPending}
                >
                  {createMutation.isPending ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Banknote />
                  )}
                  {clip
                    ? `Record ${formatPeso(clip.price)} cash`
                    : validAmount
                      ? `Record ${formatPeso(amount)} cash`
                      : "Record cash"}
                </Button>
              )}
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default TakePaymentFormModal;
