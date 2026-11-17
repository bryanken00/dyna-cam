import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Globe, Loader2, RadioTower, Save, Undo2, X } from "lucide-react";
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
import LiveChip from "../../components/LiveChip";
import PasswordInput from "../../../../../components/PasswordInput";
import StatusDot from "../../../../../components/StatusDot";
import StatusToggle from "../../../../../components/StatusToggle";
import StreamLayoutPicker from "../../../../../components/StreamLayoutPicker";
import {
  STREAM_LAYOUTS,
  courtStreamHealth,
  courtUpdatePayload,
} from "../../../../../utils/dynaCam";
import { isRtmpUrl, isWebUrl } from "../../../../../utils/tapo";
import { useUpdateCourt } from "../../../../../services/requests/admin/courts";

const RTMP_MAX = 500;
const WATCH_URL_MAX = 255;
const STREAM_ON = "Streaming";
const STREAM_OFF = "Off";
const STREAM_TOGGLE_OPTIONS = [
  { v: STREAM_OFF, dot: "var(--color-text-muted)" },
  { v: STREAM_ON, dot: "var(--color-error)" },
];

// `hasStoredStream`: an RTMP address is already saved, so streaming can be
// switched on without typing a new one.
const buildSchema = (hasStoredStream) =>
  z
    .object({
      streamEnabled: z.boolean(),
      streamRtmpUrl: z
        .string()
        .trim()
        .max(RTMP_MAX, `Keep the address under ${RTMP_MAX} characters`)
        .refine(
          (v) => v === "" || isRtmpUrl(v),
          "Enter the stream's RTMP address (with the stream key), starting with rtmp://",
        ),
      removeStream: z.boolean(),
      streamLayout: z.enum(STREAM_LAYOUTS),
      streamWatchUrl: z
        .string()
        .trim()
        .max(WATCH_URL_MAX, `Keep the link under ${WATCH_URL_MAX} characters`)
        .refine(
          (v) => v === "" || isWebUrl(v),
          "Enter the link players open to watch, starting with https://",
        ),
    })
    .superRefine((v, ctx) => {
      if (v.streamEnabled && !v.removeStream && v.streamRtmpUrl === "" && !hasStoredStream) {
        ctx.addIssue({
          code: "custom",
          path: ["streamRtmpUrl"],
          message: "Enter the stream's RTMP address to turn live streaming on",
        });
      }
    });

/** The layout a court can stream: anything with camera 2, else Cam 1. */
const layoutOf = (court) =>
  court.camera2?.configured ? court.streamLayout || "CAM1" : "CAM1";

const valuesFrom = (court) => ({
  streamEnabled: !!court.stream?.enabled,
  streamRtmpUrl: "",
  removeStream: false,
  streamLayout: layoutOf(court),
  streamWatchUrl: court.stream?.watchUrl || "",
});

/** What each layout costs the recorder box. */
const LAYOUT_HINT = {
  CAM1: "Cam 1's video is copied as it comes — light on the recorder box.",
  CAM2: "Cam 2's video is copied as it comes — light on the recorder box.",
  STACKED:
    "Both cameras, Cam 1 above Cam 2 (1280×1440). The recorder box re-encodes it: more CPU, and about 3 Mbit/s of upload.",
};

/**
 * Live streaming to YouTube / Facebook from the recorder box. On a court
 * with camera 2 it also picks what the stream shows: Cam 1, Cam 2 or both
 * stacked.
 */
const StreamSection = ({ court, canWrite }) => {
  const stream = court.stream;
  const hasStoredStream = !!stream?.configured;
  const hasCamera2 = !!court.camera2?.configured;
  // What the box reports about the running stream (refreshed with the court)
  const streamHealth = stream?.enabled ? courtStreamHealth(court.camera?.live) : null;
  const schema = useMemo(() => buildSchema(hasStoredStream), [hasStoredStream]);

  const form = useForm({ resolver: zodResolver(schema), defaultValues: valuesFrom(court) });
  const {
    formState: { isDirty },
  } = form;
  const [streamEnabled, removeStream, streamLayout] = useWatch({
    control: form.control,
    name: ["streamEnabled", "removeStream", "streamLayout"],
  });
  const updateMutation = useUpdateCourt();

  const setRemoveStream = (next) => {
    form.setValue("removeStream", next, { shouldDirty: true });
    if (next) {
      // Removing the address also turns streaming off (the API does the same)
      form.setValue("streamRtmpUrl", "");
      form.setValue("streamEnabled", false, { shouldDirty: true });
      form.clearErrors(["streamRtmpUrl"]);
    }
  };

  const onSubmit = async (values) => {
    try {
      await updateMutation.mutateAsync({
        courtId: court.courtId,
        courtData: courtUpdatePayload(court, {
          // Enabled + watch link are a full update; the RTMP address is
          // write-only — omitted keeps the saved one
          streamEnabled: values.removeStream ? false : values.streamEnabled,
          removeStream: values.removeStream,
          streamWatchUrl: values.streamWatchUrl,
          streamLayout: hasCamera2 ? values.streamLayout : "CAM1",
          ...(values.streamRtmpUrl && !values.removeStream
            ? { streamRtmpUrl: values.streamRtmpUrl }
            : {}),
        }),
        successMessage: "Live stream settings saved",
      });
      form.reset({
        streamEnabled: values.removeStream ? false : values.streamEnabled,
        streamRtmpUrl: "",
        removeStream: false,
        streamLayout: hasCamera2 ? values.streamLayout : "CAM1",
        streamWatchUrl: values.streamWatchUrl,
      });
    } catch (error) {
      // the mutation's onError already surfaced a toast
      console.error("Save stream error:", error);
    }
  };

  return (
    <SetupSection
      id="court-stream"
      title="Live stream"
      description="Stream the court to YouTube or Facebook. The recorder box sends it over its own camera connection — nothing to set up on the camera (a Tapo C200 serves only one connection)."
      aside={stream?.enabled ? <LiveChip title={stream.watchUrl} /> : null}
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} autoComplete="off">
          {streamHealth && (
            <div
              className="mb-5 px-3.5 py-3"
              aria-live="polite"
              style={{
                border: "1px solid var(--color-line)",
                borderRadius: 10,
                background: "var(--color-surface-sunken)",
              }}
            >
              <StatusDot tone={streamHealth.tone}>
                <span className="font-semibold" style={{ color: "var(--color-text-dark)" }}>
                  {streamHealth.label}
                </span>
              </StatusDot>
              {streamHealth.note && (
                <div
                  className="mt-1"
                  style={{ fontSize: 13, color: "var(--color-text-secondary)" }}
                >
                  {streamHealth.note}
                </div>
              )}
            </div>
          )}

          <fieldset disabled={!canWrite} className="m-0 p-0 border-0 min-w-0">
            <FormField
              control={form.control}
              name="streamEnabled"
              render={({ field }) => (
                <FormItem className="mb-5">
                  <FormLabel>Stream this court live</FormLabel>
                  <StatusToggle
                    value={field.value ? STREAM_ON : STREAM_OFF}
                    onChange={(v) => canWrite && field.onChange(v === STREAM_ON)}
                    options={STREAM_TOGGLE_OPTIONS}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />

            {hasCamera2 && (
              <FormField
                control={form.control}
                name="streamLayout"
                render={({ field }) => (
                  <FormItem className="mb-5">
                    <FormLabel>What the stream shows</FormLabel>
                    <StreamLayoutPicker
                      value={field.value}
                      onChange={(v) => canWrite && field.onChange(v)}
                      disabled={!canWrite}
                    />
                    <FormDescription>
                      {LAYOUT_HINT[streamLayout]} Saved with the stream settings;
                      a running stream restarts for a few seconds to switch.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {hasStoredStream && (
              <div
                className="flex items-center justify-between gap-3 flex-wrap mb-5 px-3.5 py-3"
                style={{
                  border: "1px solid var(--color-line)",
                  borderRadius: 10,
                  background: "var(--color-surface-sunken)",
                }}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <RadioTower
                    className="w-4 h-4 shrink-0"
                    style={{
                      color: removeStream
                        ? "var(--color-text-muted)"
                        : "var(--color-secondary-color)",
                    }}
                  />
                  <div className="min-w-0">
                    <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                      {removeStream
                        ? "The stream address will be removed when you save"
                        : "Current stream address"}
                    </div>
                    {!removeStream && (
                      <div
                        className="font-mono truncate"
                        style={{ fontSize: 12.5, color: "var(--color-text-dark)" }}
                        title={stream.display || undefined}
                      >
                        {stream.display || "Set, but can't be read — enter it again"}
                      </div>
                    )}
                  </div>
                </div>
                {canWrite &&
                  (removeStream ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => setRemoveStream(false)}>
                      <Undo2 />
                      Keep stream
                    </Button>
                  ) : (
                    <Button type="button" variant="outline" size="sm" onClick={() => setRemoveStream(true)}>
                      <X />
                      Remove stream
                    </Button>
                  ))}
              </div>
            )}

            {!removeStream && canWrite && (
              <FormField
                control={form.control}
                name="streamRtmpUrl"
                render={({ field }) => (
                  <FormItem className="mb-5">
                    <FormLabel>
                      {hasStoredStream ? "New stream address" : "Stream address (RTMP)"}
                      {streamEnabled && !hasStoredStream && (
                        <span style={{ color: "var(--color-error)" }}> *</span>
                      )}
                    </FormLabel>
                    <FormControl>
                      <PasswordInput
                        showLock={false}
                        placeholder="rtmp://a.rtmp.youtube.com/live2/xxxx-xxxx-xxxx-xxxx"
                        className="font-mono"
                        maxLength={RTMP_MAX}
                        spellCheck={false}
                        autoComplete="new-password"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      From YouTube Studio → Go live → Stream (Stream URL + Stream key
                      joined with &apos;/&apos;), or Facebook Live Producer. The key
                      stays secret — only its last 4 characters are shown.
                      {hasStoredStream && " Leave blank to keep the current address."}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="streamWatchUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Watch link</FormLabel>
                  <div className="relative">
                    <Globe
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
                      style={{ color: "var(--color-text-muted)" }}
                    />
                    <FormControl>
                      <Input
                        inputMode="url"
                        placeholder="https://www.youtube.com/@yourvenue/live"
                        className="h-10 pl-9"
                        maxLength={WATCH_URL_MAX}
                        spellCheck={false}
                        autoComplete="off"
                        {...field}
                      />
                    </FormControl>
                  </div>
                  <FormDescription>
                    Shown as &quot;Watch live&quot; on the court&apos;s QR page while the
                    stream is on and the recorder box is online.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {canWrite && (
              <div className="flex justify-end mt-5">
                <Button type="submit" disabled={!isDirty || updateMutation.isPending}>
                  {updateMutation.isPending ? <Loader2 className="animate-spin" /> : <Save />}
                  Save stream settings
                </Button>
              </div>
            )}
          </fieldset>
        </form>
      </Form>
    </SetupSection>
  );
};

export default StreamSection;
