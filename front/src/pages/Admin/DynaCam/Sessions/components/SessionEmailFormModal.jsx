import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Loader2, Mail } from "lucide-react";

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
import { useUpdateSessionEmail } from "../../../../../services/requests/admin/sessions";

// Same rule as the API: optional, a valid address, ≤255
const schema = z.object({
  email: z
    .string()
    .trim()
    .max(255, "Keep the email under 255 characters")
    .refine((v) => v === "" || z.string().email().safeParse(v).success, "Enter a valid email"),
});

/**
 * CR-018 "Player email": fix (or clear) the email a game's Google Drive link
 * is sent to. A new address gets the link again by itself once the game is
 * ready for it. A short form, so a Dialog. Props: `{ open, onClose, onSuccess, session }`.
 */
const SessionEmailFormModal = ({ open, onClose, onSuccess, session }) => {
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { email: "" } });
  const updateMutation = useUpdateSessionEmail();

  useEffect(() => {
    if (open) form.reset({ email: session?.email || "" });
  }, [open, form, session?.email]);

  const onSubmit = async (values) => {
    try {
      await updateMutation.mutateAsync({ sessionId: session.sessionId, email: values.email });
      onSuccess?.();
    } catch (error) {
      // the mutation's onError already surfaced a toast
      console.error("Update player email error:", error);
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
                <Mail className="w-4.5 h-4.5" />
                Player email
              </DialogTitle>
              <DialogDescription>
                {session ? (
                  <>
                    {decodeHTML(session.courtName)} · {decodeHTML(session.venueName)}. The game&apos;s
                    Google Drive link is emailed here once its videos are in Drive and it&apos;s
                    paid — a new address gets it again.
                  </>
                ) : null}
              </DialogDescription>
            </DialogHeader>

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      inputMode="email"
                      autoCapitalize="none"
                      placeholder="e.g., juan@gmail.com"
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

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? <Loader2 className="animate-spin" /> : <Mail />}
                Save email
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default SessionEmailFormModal;
