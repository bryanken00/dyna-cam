import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { CircleAlert, Loader2, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Form, FormField, FormItem, FormMessage } from "@/components/ui/form";

import StreamLayoutPicker from "../../../../components/StreamLayoutPicker";
import { STREAM_LAYOUTS } from "../../../../utils/dynaCam";
import { useSaveStreamSetup } from "../../../../services/requests/public/stream-setup";

const schema = z.object({ layout: z.enum(STREAM_LAYOUTS) });

/**
 * Switch the cameras of a stream that is already saved — a layout-only PUT
 * (`{ layout }`), no key needed. A running stream restarts for a few seconds.
 *
 * @param {string} code
 * @param {string} layout          the stream's current layout
 * @param {() => void} onSuccess
 * @param {() => void} onCancel
 * @param {() => void} [onGone]    404 / 409 — the page re-reads the setup
 */
const StreamLayoutForm = ({ code, layout, onSuccess, onCancel, onGone }) => {
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { layout: STREAM_LAYOUTS.includes(layout) ? layout : "STACKED" },
  });
  const {
    formState: { isDirty },
  } = form;
  const rootError = form.formState.errors.root?.server?.message;

  const saveMutation = useSaveStreamSetup(code);
  const isPending = saveMutation.isPending;

  const onSubmit = async (values) => {
    try {
      await saveMutation.mutateAsync({ layout: values.layout });
      saveMutation.reset();
      onSuccess?.();
    } catch (error) {
      const status = error?.response?.status;
      const fieldError = (error?.response?.data?.errors || []).find(
        (e) => e.field === "layout",
      );
      if (status === 400 && fieldError) {
        form.setError("layout", { message: fieldError.message });
        return;
      }
      form.setError("root.server", {
        message: !error?.response
          ? "Couldn't reach Dyna Cam — check your connection and try again."
          : error.response.data?.message || "Something went wrong. Please try again.",
      });
      if (status === 404 || status === 409) onGone?.();
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
        <FormField
          control={form.control}
          name="layout"
          render={({ field }) => (
            <FormItem>
              <StreamLayoutPicker
                value={field.value}
                onChange={field.onChange}
                disabled={isPending}
                showNotes={false}
              />
              <FormMessage />
            </FormItem>
          )}
        />
        <p className="m-0" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
          A live stream restarts for a few seconds to switch.
        </p>
        {rootError && (
          <div
            role="alert"
            className="flex items-start gap-2"
            style={{ fontSize: 13, color: "var(--color-text-dark)" }}
          >
            <CircleAlert
              className="w-4 h-4 mt-0.5 shrink-0"
              style={{ color: "var(--color-error)" }}
            />
            <span>{rootError}</span>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2.5">
          <Button
            type="button"
            variant="outline"
            className="h-10"
            disabled={isPending}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button type="submit" className="h-10" disabled={!isDirty || isPending}>
            {isPending ? <Loader2 className="animate-spin" /> : <Save />}
            Switch
          </Button>
        </div>
      </form>
    </Form>
  );
};

export default StreamLayoutForm;
