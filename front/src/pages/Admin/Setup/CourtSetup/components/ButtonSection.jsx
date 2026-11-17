import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Keyboard, Loader2, Save, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import SetupSection from "./SetupSection";
import { decodeHTML } from "../../../../../utils/decode-html";
import {
  BUTTON_CODE_MAX,
  BUTTON_CODE_PATTERN,
  BUTTON_PRESS_PORT,
  courtUpdatePayload,
  suggestButtonCode,
} from "../../../../../utils/dynaCam";
import { useUpdateCourt } from "../../../../../services/requests/admin/courts";

const schema = z.object({
  // Optional; unique across all courts (the API answers 409 on a clash)
  buttonCode: z
    .string()
    .trim()
    .refine((v) => v === "" || BUTTON_CODE_PATTERN.test(v), "Use 3–32 letters, digits, - or _"),
});

const iconPrefix =
  "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2";

/** The court's Wi-Fi button code (optional). Saves with the court's full PUT. */
const ButtonSection = ({ court, canWrite }) => {
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { buttonCode: court.buttonCode || "" },
  });
  const {
    formState: { isDirty },
  } = form;
  const buttonCode = useWatch({ control: form.control, name: "buttonCode" });
  const updateMutation = useUpdateCourt();

  const handleGenerate = () => {
    form.setValue(
      "buttonCode",
      suggestButtonCode(decodeHTML(court.venueName), decodeHTML(court.name)),
      { shouldDirty: true, shouldValidate: true },
    );
  };

  const onSubmit = async (values) => {
    try {
      await updateMutation.mutateAsync({
        courtId: court.courtId,
        // PUT is a full update: "" clears the code
        courtData: courtUpdatePayload(court, { buttonCode: values.buttonCode }),
        successMessage: values.buttonCode ? "Button code saved" : "Button code cleared",
      });
      form.reset({ buttonCode: values.buttonCode });
    } catch (error) {
      // the mutation's onError already surfaced a toast (409 = code taken)
      console.error("Save button code error:", error);
    }
  };

  return (
    <SetupSection
      id="court-button"
      title="Button"
      description="Optional — a Wi-Fi button on the court that saves a clip when pressed."
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} autoComplete="off">
          <fieldset disabled={!canWrite} className="m-0 p-0 border-0 min-w-0">
            <FormField
              control={form.control}
              name="buttonCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Button code</FormLabel>
                  <div className="flex items-start gap-2 flex-wrap">
                    <div className="relative flex-1 min-w-56">
                      <Keyboard className={iconPrefix} style={{ color: "var(--color-text-muted)" }} />
                      <FormControl>
                        <Input
                          placeholder="e.g., dink-city-court-1"
                          className="h-10 pl-9 font-mono"
                          maxLength={BUTTON_CODE_MAX}
                          spellCheck={false}
                          autoCapitalize="none"
                          autoComplete="off"
                          {...field}
                        />
                      </FormControl>
                    </div>
                    {canWrite && (
                      <>
                        <Button type="button" variant="outline" className="h-10" onClick={handleGenerate}>
                          <WandSparkles />
                          Generate
                        </Button>
                        <Button
                          type="submit"
                          className="h-10"
                          disabled={!isDirty || updateMutation.isPending}
                        >
                          {updateMutation.isPending ? <Loader2 className="animate-spin" /> : <Save />}
                          Save
                        </Button>
                      </>
                    )}
                  </div>
                  <FormDescription>
                    Set the court&apos;s Wi-Fi button to call{" "}
                    <span className="font-mono break-all">
                      http://&lt;recorder-box-address&gt;:{BUTTON_PRESS_PORT}/press/
                      {buttonCode?.trim() || "<code>"}
                    </span>{" "}
                    — see the recorder box guide.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </fieldset>
        </form>
      </Form>
    </SetupSection>
  );
};

export default ButtonSection;
