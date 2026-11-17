import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { KeyRound, Loader2, Smartphone } from "lucide-react";

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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

import { decodeHTML } from "../../../../../utils/decode-html";
import { formatDate, formatTimeRange } from "../../../../../utils/dynaCam";
import { useCreateSessionPairingCode } from "../../../../../services/requests/admin/sessions";

// Mirrors the API: { name } 1–100 characters
const schema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the device a name")
    .max(100, "Keep the name under 100 characters"),
});

const iconPrefix =
  "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2";

/** "Court 1 device" — what staff will recognise in the session's Devices. */
const defaultName = (session) => {
  const court = decodeHTML(session?.courtName);
  return court ? `${court} device`.slice(0, 100) : "Court device";
};

/**
 * "Pair a device" — name the phone or tablet, then get a 6-digit key for this
 * session. A one-field form, so a Dialog rather than a Sheet (the
 * `XFormModal` variation). Props follow the form contract:
 * `{ open, onClose, onSuccess, entity }`, where `entity` is the session
 * (`{ sessionId, courtName, venueName?, startAt?, endAt? }`).
 *
 * On success `onSuccess` receives
 * `{ code, name, courtName, expiresInSeconds }` — the page stamps
 * `receivedAt` and shows it in `<PairingKeyDialog kind="session" />`.
 */
const PairDeviceFormModal = ({ open, onClose, onSuccess, entity }) => {
  const req = <span style={{ color: "var(--color-error)" }}>*</span>;

  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { name: defaultName(entity) },
  });

  useEffect(() => {
    if (open) form.reset({ name: defaultName(entity) });
  }, [open, entity, form]);

  const createMutation = useCreateSessionPairingCode();
  const isPending = createMutation.isPending;

  const handleClose = () => {
    form.reset({ name: defaultName(entity) });
    onClose();
  };

  const onSubmit = async (values) => {
    try {
      const response = await createMutation.mutateAsync({
        sessionId: entity.sessionId,
        data: { name: values.name },
      });
      const key = response?.data || {};
      onSuccess?.({
        code: key.code,
        name: values.name,
        courtName: decodeHTML(entity.courtName),
        expiresInSeconds: key.expiresInSeconds,
      });
    } catch (error) {
      // the mutation's onError already surfaced a toast (409: session over)
      console.error("Pair device error:", error);
    }
  };

  const when =
    entity?.startAt && entity?.endAt
      ? `${formatDate(entity.startAt)}, ${formatTimeRange(entity.startAt, entity.endAt)}`
      : null;

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
            onSubmit={form.handleSubmit(onSubmit)}
            autoComplete="off"
            className="space-y-5"
          >
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Smartphone className="w-4.5 h-4.5" />
                Pair a device
              </DialogTitle>
              <DialogDescription>
                A phone or tablet at the court shows this session live, with
                the player&apos;s download QR.
                {entity?.courtName && (
                  <>
                    {" "}
                    {decodeHTML(entity.courtName)}
                    {entity.venueName && ` · ${decodeHTML(entity.venueName)}`}
                    {when && ` — ${when}`}.
                  </>
                )}
              </DialogDescription>
            </DialogHeader>

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Device name {req}</FormLabel>
                  <div className="relative">
                    <Smartphone
                      className={iconPrefix}
                      style={{ color: "var(--color-text-muted)" }}
                    />
                    <FormControl>
                      <Input
                        placeholder="e.g., Court 1 tablet"
                        className="h-10 pl-9"
                        maxLength={100}
                        {...field}
                      />
                    </FormControl>
                  </div>
                  <FormDescription>
                    Next you&apos;ll get a 6-digit key to type into the Dyna Cam
                    app on the device. It works for 10 minutes, or until the
                    session ends.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? <Loader2 className="animate-spin" /> : <KeyRound />}
                Create pairing key
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default PairDeviceFormModal;
