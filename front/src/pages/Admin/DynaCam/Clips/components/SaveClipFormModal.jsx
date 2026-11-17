import { useEffect, useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Loader2, Scissors } from "lucide-react";

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

import SearchableSelect from "../../../../../components/SearchableSelect";
import { decodeHTML } from "../../../../../utils/decode-html";
import {
  useCreateClip,
  useGetClipOptions,
} from "../../../../../services/requests/admin/clips";

const schema = z.object({
  courtId: z.string().min(1, "Choose the court to save"),
});

const EMPTY = { courtId: "" };

/**
 * "Save clip now" — staff save the last 60 seconds on a court. A one-field
 * form, so a Dialog rather than a Sheet (the `XFormModal` variation).
 * Props follow the form contract: `{ open, onClose, onSuccess }`.
 */
const SaveClipFormModal = ({ open, onClose, onSuccess }) => {
  const req = <span style={{ color: "var(--color-error)" }}>*</span>;

  const form = useForm({ resolver: zodResolver(schema), defaultValues: EMPTY });

  useEffect(() => {
    if (open) form.reset(EMPTY);
  }, [open, form]);

  // Same query as the page's filters, so it is usually already cached
  const { data: optionsData, isLoading: optionsLoading } = useGetClipOptions();
  const courtOptions = useMemo(
    () =>
      (optionsData?.data?.courts || [])
        // Only courts that can save now (court and venue both Active)
        .filter((c) => c.active !== false)
        .map((c) => ({
          value: c.courtId,
          label: decodeHTML(c.name),
          // Labelled by venue — several venues can each have a "Court 1"
          hint: decodeHTML(c.venueName),
        })),
    [optionsData],
  );

  const createMutation = useCreateClip();

  const handleClose = () => {
    form.reset(EMPTY);
    onClose();
  };

  const onSubmit = async (values) => {
    try {
      await createMutation.mutateAsync({ courtId: values.courtId });
      onSuccess?.();
    } catch (error) {
      // the mutation's onError already surfaced a toast; keep the dialog open
      console.error("Save clip error:", error);
    }
  };

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
                <Scissors className="w-4.5 h-4.5" />
                Save clip now
              </DialogTitle>
              <DialogDescription>
                Saves the last 60 seconds on a court, the same as a player
                scanning its QR code.
              </DialogDescription>
            </DialogHeader>

            <FormField
              control={form.control}
              name="courtId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Court {req}</FormLabel>
                  <FormControl>
                    <SearchableSelect
                      value={field.value || undefined}
                      onValueChange={field.onChange}
                      options={courtOptions}
                      placeholder={
                        optionsLoading ? "Loading courts…" : "Select court"
                      }
                      searchPlaceholder="Type a court or venue…"
                      emptyText="No court matches that."
                    />
                  </FormControl>
                  <FormDescription>
                    The court&apos;s camera and its venue&apos;s recorder box
                    must be online.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Scissors />
                )}
                Save clip
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default SaveClipFormModal;
