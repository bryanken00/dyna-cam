import { useEffect, useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import dayjs from "dayjs";
import { Loader2, TimerReset } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";

import GameTimeFields from "../../../../../components/GameTimeFields";
import { decodeHTML } from "../../../../../utils/decode-html";
import { GAME_MAX_TOTAL_MINUTES, formatMinutes } from "../../../../../utils/dynaCam";
import { gameTimeFields, toGameMinutes } from "../../../../../utils/gameTime";
import { useExtendSession } from "../../../../../services/requests/admin/sessions";

/** One-tap amounts to add, in minutes. */
const ADD_TIME_PRESETS = [15, 30, 60];

const EMPTY = { hours: "0", minutes: "30" };

/**
 * CR-016 "Add time" for a recording game: its stop time moves later, up to 6
 * hours in all. The payment is left as it is (staff collect the extra at the
 * desk). A short form, so a Dialog. Props: `{ open, onClose, onSuccess, session }`
 * — `session` needs `sessionId`, `courtName`, `venueName`, `endAt`, `durationMinutes`.
 */
const AddTimeFormModal = ({ open, onClose, onSuccess, session }) => {
  // How much can still be added before the game reaches 6 hours
  const left = Math.max(0, GAME_MAX_TOTAL_MINUTES - (Number(session?.durationMinutes) || 0));

  const schema = useMemo(
    () =>
      z.object(gameTimeFields).superRefine((values, ctx) => {
        const total = toGameMinutes(values);
        if (total < 1) {
          ctx.addIssue({ code: "custom", path: ["minutes"], message: "Add at least 1 minute" });
        } else if (total > left) {
          ctx.addIssue({
            code: "custom",
            path: ["hours"],
            message: left
              ? `A game is at most 6 hours — up to ${formatMinutes(left)} more`
              : "This game is already 6 hours long",
          });
        }
      }),
    [left],
  );

  const form = useForm({ resolver: zodResolver(schema), defaultValues: EMPTY });
  const extendMutation = useExtendSession();

  useEffect(() => {
    if (open) form.reset(EMPTY);
  }, [open, form]);

  const hours = useWatch({ control: form.control, name: "hours" }) ?? "";
  const minutes = useWatch({ control: form.control, name: "minutes" }) ?? "";
  const adding = toGameMinutes({ hours, minutes });
  const newEnd =
    session?.endAt && adding > 0 ? dayjs(session.endAt).add(adding, "minute") : null;

  const onSubmit = async (values) => {
    const added = toGameMinutes(values);
    try {
      const response = await extendMutation.mutateAsync({
        sessionId: session.sessionId,
        minutes: added,
      });
      const endAt = response?.data?.session?.endAt;
      toast.success(
        endAt
          ? `Added ${formatMinutes(added)} — recording now stops at ${dayjs(endAt).format("h:mm A")}`
          : `Added ${formatMinutes(added)}`,
      );
      onSuccess?.();
    } catch (error) {
      // the mutation's onError already surfaced a toast
      console.error("Add time error:", error);
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
                <TimerReset className="w-4.5 h-4.5" />
                Add time
              </DialogTitle>
              <DialogDescription>
                {session ? (
                  <>
                    {decodeHTML(session.courtName)} · {decodeHTML(session.venueName)}
                    {session.endAt && (
                      <> · stops at {dayjs(session.endAt).format("h:mm A")}</>
                    )}
                    . The payment stays as it is — collect any extra at the desk.
                  </>
                ) : null}
              </DialogDescription>
            </DialogHeader>

            <GameTimeFields form={form} presets={ADD_TIME_PRESETS} autoFocus />

            <p className="m-0" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
              {newEnd
                ? `Recording will stop at ${newEnd.format("h:mm A")}. `
                : ""}
              {left > 0
                ? `Up to ${formatMinutes(left)} more (6 hours in all).`
                : "This game is already 6 hours long."}
            </p>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={extendMutation.isPending || left === 0}>
                {extendMutation.isPending ? <Loader2 className="animate-spin" /> : <TimerReset />}
                {adding > 0 ? `Add ${formatMinutes(adding)}` : "Add time"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default AddTimeFormModal;
