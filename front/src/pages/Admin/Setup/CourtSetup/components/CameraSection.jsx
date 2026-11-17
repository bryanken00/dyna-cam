import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import {
  Link2,
  Loader2,
  Network,
  Pencil,
  Plus,
  Save,
  User,
  Video,
  VideoOff,
} from "lucide-react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import CameraLiveCheck from "./CameraLiveCheck";
import SetupSection from "./SetupSection";
import StepLabel from "./StepLabel";
import CameraStatusChip from "../../components/CameraStatusChip";
import PasswordInput from "../../../../../components/PasswordInput";
import StatusToggle from "../../../../../components/StatusToggle";
import { confirm } from "../../../../../store/confirmStore";
import { courtUpdatePayload } from "../../../../../utils/dynaCam";
import {
  TAPO_CREDENTIAL_MAX,
  TAPO_CREDENTIAL_MIN,
  TAPO_DEFAULT_STREAM,
  TAPO_STREAMS,
  buildTapoRtspUrl,
  isRtspUrl,
  isValidIPv4,
} from "../../../../../utils/tapo";
import { useUpdateCourt } from "../../../../../services/requests/admin/courts";

const TAPO = "Tapo camera";
const OTHER = "Other RTSP camera";
const CAMERA_TYPE_OPTIONS = [
  { v: TAPO, dot: "var(--color-secondary-color)" },
  { v: OTHER, dot: "var(--color-text-muted)" },
];

const RTSP_MAX = 500; // courts.validator.js caps the URL at 500
const credMessage = `Use ${TAPO_CREDENTIAL_MIN}–${TAPO_CREDENTIAL_MAX} characters`;
const credOk = (v) =>
  v.length >= TAPO_CREDENTIAL_MIN && v.length <= TAPO_CREDENTIAL_MAX;

// Here a save always sets a camera: a Tapo camera needs all three of IP,
// username and password; another camera needs its RTSP address.
const cameraSchema = z
  .object({
    cameraType: z.enum([TAPO, OTHER]),
    tapoIp: z.string().trim(),
    tapoUsername: z.string(),
    tapoPassword: z.string(),
    tapoStream: z.enum(TAPO_STREAMS.map((s) => s.value)),
    rtspUrl: z.string().trim(),
  })
  .superRefine((v, ctx) => {
    const issue = (path, message) => ctx.addIssue({ code: "custom", path: [path], message });
    if (v.cameraType === TAPO) {
      if (!isValidIPv4(v.tapoIp)) issue("tapoIp", "Enter an IPv4 address, e.g. 192.168.1.50");
      if (!credOk(v.tapoUsername)) issue("tapoUsername", credMessage);
      if (!credOk(v.tapoPassword)) issue("tapoPassword", credMessage);
    } else if (!isRtspUrl(v.rtspUrl)) {
      issue("rtspUrl", "Enter the camera's RTSP address, starting with rtsp://");
    } else if (v.rtspUrl.length > RTSP_MAX) {
      issue("rtspUrl", `Keep the address under ${RTSP_MAX} characters`);
    }
  });

const EMPTY = {
  cameraType: TAPO,
  tapoIp: "",
  tapoUsername: "",
  tapoPassword: "",
  tapoStream: TAPO_DEFAULT_STREAM,
  rtspUrl: "",
};

const cameraUrlFrom = (values) =>
  values.cameraType === OTHER
    ? values.rtspUrl.trim()
    : buildTapoRtspUrl({
        ip: values.tapoIp,
        username: values.tapoUsername,
        password: values.tapoPassword,
        stream: values.tapoStream,
      });

/**
 * What differs between the court's two camera slots. Camera 2 (Phase H) is
 * optional: collapsed until "Add a second camera", and removing it also puts
 * the court's live stream back on Cam 1.
 */
const SLOTS = {
  camera: {
    id: "court-camera",
    title: "Camera",
    description: "Connect the court's camera, then check what the recorder box receives.",
    urlKey: "cameraRtspUrl",
    removeKey: "removeCamera",
    optional: false,
    savedMessage: "Camera saved — checking it now",
    removedMessage: "Camera removed",
    removeLabel: "Remove",
    removeTitle: "Remove camera",
    removeText:
      "Remove this court's camera? The recorder box stops recording it, so players can't save clips here until a camera is set up again.",
    emptyText: "No camera set up for this court yet.",
    previewAlt: "Latest preview from the court camera",
  },
  camera2: {
    id: "court-camera2",
    title: "Camera 2 (optional)",
    description:
      "A second angle on the same court. Clips and session videos then show both, Cam 1 above Cam 2, and the live stream can show either or both.",
    urlKey: "camera2RtspUrl",
    removeKey: "removeCamera2",
    optional: true,
    savedMessage: "Camera 2 saved — checking it now",
    removedMessage: "Camera 2 removed",
    removeLabel: "Remove camera 2",
    removeTitle: "Remove camera 2",
    removeText:
      "Remove this court's second camera? Clips and session videos go back to Cam 1 only, and the court's live stream switches to Cam 1.",
    emptyText: "No second camera on this court.",
    previewAlt: "Latest preview from the court's camera 2",
  },
};

const iconPrefix =
  "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2";
const mutedIcon = { color: "var(--color-text-muted)" };
const tipStyle = { fontSize: 12.5, color: "var(--color-text-secondary)" };

/**
 * Guided camera setup: ① camera type → ② address → save → ③ live check.
 * The camera address is write-only, so a configured camera shows its masked
 * address and "Change camera" opens steps ① and ② again.
 *
 * `slot` picks the court's camera: "camera" (always shown as a form until
 * set) or "camera2" (optional — collapsed behind "Add a second camera").
 * `onSaved(slot)` starts that camera's live check.
 */
const CameraSection = ({ slot = "camera", court, canWrite, checking, justSaved, onSaved }) => {
  const cfg = SLOTS[slot] || SLOTS.camera;
  const camera = court[slot];
  const configured = !!camera?.configured;
  // An optional camera starts collapsed; a required one opens the form
  const [editing, setEditing] = useState(!configured && !cfg.optional);
  const showForm = canWrite && (editing || (!configured && !cfg.optional));

  const form = useForm({ resolver: zodResolver(cameraSchema), defaultValues: EMPTY });
  const cameraType = useWatch({ control: form.control, name: "cameraType" });

  const updateMutation = useUpdateCourt();

  const onSubmit = async (values) => {
    const rtspUrl = cameraUrlFrom(values);
    if (rtspUrl.length > RTSP_MAX) {
      form.setError("tapoPassword", {
        message: "The camera address is too long — shorten the username or password",
      });
      return;
    }
    try {
      await updateMutation.mutateAsync({
        courtId: court.courtId,
        courtData: courtUpdatePayload(court, { [cfg.urlKey]: rtspUrl }),
        successMessage: cfg.savedMessage,
      });
      form.reset(EMPTY);
      setEditing(false);
      onSaved?.(slot);
    } catch (error) {
      // the mutation's onError already surfaced a toast
      console.error("Save camera error:", error);
    }
  };

  const handleRemove = async () => {
    const ok = await confirm({
      title: cfg.removeTitle,
      description: cfg.removeText,
      confirmText: cfg.removeTitle,
      cancelText: "Cancel",
      danger: true,
    });
    if (!ok) return;
    updateMutation.mutate({
      courtId: court.courtId,
      courtData: courtUpdatePayload(court, {
        [cfg.removeKey]: true,
        // Without camera 2 only Cam 1 can be streamed
        ...(slot === "camera2" ? { streamLayout: "CAM1" } : {}),
      }),
      successMessage: cfg.removedMessage,
    });
  };

  const handleTypeChange = (next, field) => {
    if (next === field.value) return;
    field.onChange(next);
    // The hidden type's fields aren't sent — clear them and their errors
    const hidden = next === TAPO ? ["rtspUrl"] : ["tapoIp", "tapoUsername", "tapoPassword"];
    hidden.forEach((f) => form.setValue(f, ""));
    form.clearErrors();
  };

  return (
    <SetupSection
      id={cfg.id}
      title={cfg.title}
      description={cfg.description}
      aside={configured || !cfg.optional ? <CameraStatusChip camera={camera} /> : null}
    >
      {/* Current camera (address is write-only — shown masked) */}
      {configured && !showForm && (
        <div
          className="flex items-center justify-between gap-3 flex-wrap mb-5 px-3.5 py-3"
          style={{
            border: "1px solid var(--color-line)",
            borderRadius: 10,
            background: "var(--color-surface-sunken)",
          }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Video className="w-4 h-4 shrink-0" style={{ color: "var(--color-secondary-color)" }} />
            <div className="min-w-0">
              <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                Camera address
              </div>
              <div
                className="font-mono truncate"
                style={{ fontSize: 12.5, color: "var(--color-text-dark)" }}
                title={camera.display || undefined}
              >
                {camera.display || "Set, but can't be read — enter it again"}
              </div>
            </div>
          </div>
          {canWrite && (
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Pencil />
                Change camera
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleRemove}
                disabled={updateMutation.isPending}
              >
                <VideoOff />
                {cfg.removeLabel}
              </Button>
            </div>
          )}
        </div>
      )}

      {!configured && !canWrite && (
        <p className="m-0" style={{ fontSize: 13.5, color: "var(--color-text-muted)" }}>
          {cfg.emptyText}
        </p>
      )}

      {/* Optional camera, not set: collapsed */}
      {!configured && canWrite && !showForm && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="m-0" style={{ fontSize: 13.5, color: "var(--color-text-muted)" }}>
            {cfg.emptyText}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Plus />
            Add a second camera
          </Button>
        </div>
      )}

      {/* Steps ① and ② */}
      {showForm && (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} autoComplete="off" className="mb-6">
            <StepLabel n={1}>Camera type</StepLabel>
            <FormField
              control={form.control}
              name="cameraType"
              render={({ field }) => (
                <FormItem className="mb-6">
                  <StatusToggle
                    value={field.value}
                    onChange={(next) => handleTypeChange(next, field)}
                    options={CAMERA_TYPE_OPTIONS}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />

            <StepLabel n={2}>Camera address</StepLabel>
            {cameraType === TAPO ? (
              <>
                <ul className="m-0 mb-4 pl-5 space-y-1 list-disc" style={tipStyle}>
                  <li>
                    In the Tapo app make a <strong>Camera Account</strong> (Camera
                    settings → Advanced settings → Camera Account) and use it here —
                    not your Tapo login. {TAPO_CREDENTIAL_MIN}–{TAPO_CREDENTIAL_MAX}{" "}
                    characters each.
                  </li>
                  <li>
                    Find the camera&apos;s IP in the Tapo app (Device info) and
                    <strong> reserve it in the venue router</strong> (DHCP
                    reservation) so it doesn&apos;t change.
                  </li>
                </ul>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                  <FormField
                    control={form.control}
                    name="tapoIp"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Camera IP address</FormLabel>
                        <div className="relative">
                          <Network className={iconPrefix} style={mutedIcon} />
                          <FormControl>
                            <Input
                              placeholder="192.168.1.50"
                              className="h-10 pl-9 font-mono"
                              inputMode="decimal"
                              spellCheck={false}
                              autoComplete="off"
                              {...field}
                            />
                          </FormControl>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="tapoStream"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Quality</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger className="h-10 w-full">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {TAPO_STREAMS.map((s) => (
                              <SelectItem key={s.value} value={s.value}>
                                {s.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="tapoUsername"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Camera account username</FormLabel>
                        <div className="relative">
                          <User className={iconPrefix} style={mutedIcon} />
                          <FormControl>
                            <Input
                              className="h-10 pl-9"
                              maxLength={TAPO_CREDENTIAL_MAX}
                              spellCheck={false}
                              autoCapitalize="none"
                              // not the admin's own login — no browser autofill
                              autoComplete="off"
                              {...field}
                            />
                          </FormControl>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="tapoPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Camera account password</FormLabel>
                        <FormControl>
                          <PasswordInput
                            maxLength={TAPO_CREDENTIAL_MAX}
                            autoComplete="new-password"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </>
            ) : (
              <FormField
                control={form.control}
                name="rtspUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>RTSP address</FormLabel>
                    <div className="relative">
                      <Link2 className={iconPrefix} style={mutedIcon} />
                      <FormControl>
                        <Input
                          placeholder="rtsp://user:password@192.168.1.50:554/stream1"
                          className="h-10 pl-9 font-mono"
                          maxLength={RTSP_MAX}
                          spellCheck={false}
                          autoComplete="off"
                          {...field}
                        />
                      </FormControl>
                    </div>
                    <FormDescription>
                      Stored encrypted and never shown again in full.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <div className="flex justify-end gap-3 mt-5">
              {(configured || cfg.optional) && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    form.reset(EMPTY);
                    setEditing(false);
                  }}
                >
                  Cancel
                </Button>
              )}
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? <Loader2 className="animate-spin" /> : <Save />}
                Save and check
              </Button>
            </div>
          </form>
        </Form>
      )}

      {/* Step ③ */}
      {configured && (
        <>
          <StepLabel n={3} done={!showForm}>
            Live check
          </StepLabel>
          <CameraLiveCheck
            camera={camera}
            checking={checking}
            justSaved={justSaved}
            showNextSteps={slot === "camera"}
            previewAlt={cfg.previewAlt}
          />
        </>
      )}
    </SetupSection>
  );
};

export default CameraSection;
