import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { CircleAlert, Loader2, Radio, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

import PasswordInput from "../../../../components/PasswordInput";
import StatusToggle from "../../../../components/StatusToggle";
import {
  RTMP_URL_PATTERN,
  STREAM_PLATFORM_LABEL,
} from "../../../../utils/dynaCam";
import { useSaveStreamSetup } from "../../../../services/requests/public/stream-setup";

const PLATFORM_OPTIONS = ["FACEBOOK", "YOUTUBE", "OTHER"].map((v) => ({
  v,
  label: STREAM_PLATFORM_LABEL[v],
}));

// Mirrors the API: a key for Facebook / YouTube, a full RTMP(S) address for
// Other. Both are trimmed — a pasted key often carries a stray space.
const schema = z
  .object({
    platform: z.enum(["FACEBOOK", "YOUTUBE", "OTHER"]),
    streamKey: z.string().trim(),
    url: z.string().trim(),
  })
  .superRefine((v, ctx) => {
    if (v.platform === "OTHER") {
      if (!RTMP_URL_PATTERN.test(v.url)) {
        ctx.addIssue({
          code: "custom",
          path: ["url"],
          message: "Paste the full address, starting with rtmp:// or rtmps://",
        });
      }
    } else if (!v.streamKey) {
      ctx.addIssue({
        code: "custom",
        path: ["streamKey"],
        message: "Paste your stream key",
      });
    }
  });

const API_FIELDS = ["platform", "streamKey", "url"];

/**
 * An outside help link. `noreferrer`: our URL carries the setup code, which
 * must not leak to Facebook / YouTube as a Referer.
 */
const HelpLink = ({ href, children }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="underline underline-offset-2"
    style={{ color: "var(--color-link)" }}
  >
    {children}
  </a>
);

/** Where the key is, per platform — short enough to read on a phone. */
const HELP = {
  FACEBOOK: (
    <>
      Open <strong className="font-semibold">Live Producer</strong> →{" "}
      <strong className="font-semibold">Streaming software</strong> → copy the{" "}
      <strong className="font-semibold">Stream key</strong>. In the Facebook app
      that&apos;s Live → Streaming software, if you see it; otherwise open
      <HelpLink href="https://www.facebook.com/live/producer">
        facebook.com/live/producer
      </HelpLink>{" "}
      in your phone&apos;s browser.
    </>
  ),
  YOUTUBE: (
    <>
      Open <strong className="font-semibold">YouTube Studio</strong> →{" "}
      <strong className="font-semibold">Go live</strong> →{" "}
      <strong className="font-semibold">Stream</strong> → copy the{" "}
      <strong className="font-semibold">Stream key</strong>. The YouTube app
      can&apos;t show it — open{" "}
      <HelpLink href="https://studio.youtube.com">studio.youtube.com</HelpLink> in
      your phone&apos;s browser.
      Going live for the first time? YouTube can take up to 24 hours to turn it
      on.
    </>
  ),
  OTHER: (
    <>
      Paste the full address your streaming service gives you, key included —
      it starts with rtmp:// or rtmps://.
    </>
  ),
};

/** Turn off everything that might remember or rewrite a pasted key. */
const SECRET_INPUT_PROPS = {
  autoComplete: "off",
  autoCapitalize: "off",
  autoCorrect: "off",
  spellCheck: false,
  "data-1p-ignore": true,
  "data-lpignore": "true",
  "data-form-type": "other",
};

/**
 * The player's stream key (or full RTMP address for Other) → Start streaming.
 * The key lives only in this form: it is sent in the PUT body, then cleared
 * from the form and the mutation as soon as the save succeeds.
 *
 * @param {string} code             the setup code from the URL
 * @param {string} [platform]       preselected (Change key)
 * @param {() => void} onSuccess    saved — show the status
 * @param {() => void} [onCancel]   back to the status (Change key only)
 * @param {() => void} [onGone]     404 / 409 — the page re-reads the setup
 */
const StreamKeyForm = ({ code, platform, onSuccess, onCancel, onGone }) => {
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { platform: platform || "FACEBOOK", streamKey: "", url: "" },
  });
  const selected = useWatch({ control: form.control, name: "platform" });
  const rootError = form.formState.errors.root?.server?.message;

  const saveMutation = useSaveStreamSetup(code);
  const isPending = saveMutation.isPending;

  const onSubmit = async (values) => {
    const payload =
      values.platform === "OTHER"
        ? { platform: "OTHER", url: values.url }
        : { platform: values.platform, streamKey: values.streamKey };
    try {
      await saveMutation.mutateAsync(payload);
      // Don't keep the key anywhere once it is saved
      form.reset({ platform: values.platform, streamKey: "", url: "" });
      saveMutation.reset();
      onSuccess?.();
    } catch (error) {
      const status = error?.response?.status;
      const body = error?.response?.data;
      const fieldErrors = (body?.errors || []).filter((e) =>
        API_FIELDS.includes(e.field),
      );
      if (status === 400 && fieldErrors.length > 0) {
        fieldErrors.forEach((e) => form.setError(e.field, { message: e.message }));
        return;
      }
      let message = body?.message;
      if (!error?.response) {
        message = "Couldn't reach Dyna Cam — check your connection and try again.";
      } else if (status === 429) {
        message = message || "Too many tries — wait a moment and try again.";
      }
      form.setError("root.server", {
        message: message || "Something went wrong. Please try again.",
      });
      if (status === 404 || status === 409) onGone?.();
    }
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        autoComplete="off"
        className="space-y-5"
      >
        <FormField
          control={form.control}
          name="platform"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Stream to</FormLabel>
              <StatusToggle
                value={field.value}
                onChange={(v) => {
                  field.onChange(v);
                  form.clearErrors();
                }}
                options={PLATFORM_OPTIONS}
              />
              <FormMessage />
            </FormItem>
          )}
        />

        {selected === "OTHER" ? (
          <FormField
            key="url"
            control={form.control}
            name="url"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Full RTMP address</FormLabel>
                <FormControl>
                  <PasswordInput
                    secretName="address"
                    placeholder="rtmps://…/your-key"
                    className="h-11"
                    {...SECRET_INPUT_PROPS}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : (
          <FormField
            key="streamKey"
            control={form.control}
            name="streamKey"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Stream key</FormLabel>
                <FormControl>
                  <PasswordInput
                    secretName="stream key"
                    placeholder="Paste your stream key"
                    className="h-11"
                    {...SECRET_INPUT_PROPS}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {/* Where to find it */}
        <div
          className="px-3.5 py-3"
          style={{
            border: "1px solid var(--color-line)",
            borderRadius: 10,
            background: "var(--color-surface-sunken)",
            fontSize: 13,
            lineHeight: 1.55,
            color: "var(--color-text-secondary)",
          }}
        >
          <p className="m-0">{HELP[selected] || HELP.FACEBOOK}</p>
          <p
            className="m-0 mt-2 flex items-start gap-1.5"
            style={{ color: "var(--color-text-dark)" }}
          >
            <ShieldCheck
              className="w-4 h-4 mt-0.5 shrink-0"
              style={{ color: "var(--color-text-muted)" }}
            />
            <span>
              Keep your key private — anyone with it can stream to your
              channel. Dyna Cam only uses it for this game.
            </span>
          </p>
        </div>

        {rootError && (
          <div
            role="alert"
            className="flex items-start gap-2 px-3.5 py-3"
            style={{
              border: "1px solid var(--color-line)",
              borderRadius: 10,
              fontSize: 13.5,
              color: "var(--color-text-dark)",
            }}
          >
            <CircleAlert
              className="w-4 h-4 mt-0.5 shrink-0"
              style={{ color: "var(--color-error)" }}
            />
            <span>{rootError}</span>
          </div>
        )}

        <div className="space-y-2.5">
          <Button type="submit" size="lg" className="h-12 w-full" disabled={isPending}>
            {isPending ? <Loader2 className="animate-spin" /> : <Radio />}
            Start streaming
          </Button>
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-11 w-full"
              disabled={isPending}
              onClick={onCancel}
            >
              Keep the current stream
            </Button>
          )}
        </div>
      </form>
    </Form>
  );
};

export default StreamKeyForm;
