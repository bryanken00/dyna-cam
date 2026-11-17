import { useEffect, useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import {
  Keyboard,
  Link2,
  Loader2,
  MapPin,
  Network,
  Plus,
  Radio,
  Undo2,
  User,
  WandSparkles,
  Video,
  VideoOff,
  X,
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
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import PasswordInput from "../../../../../components/PasswordInput";
import SearchableSelect from "../../../../../components/SearchableSelect";
import SectionLabel from "../../../../../components/SectionLabel";
import StatusToggle from "../../../../../components/StatusToggle";
import { useDiscardGuard } from "../../../../../hooks/useDiscardGuard";
import { decodeHTML } from "../../../../../utils/decode-html";
import {
  BUTTON_CODE_MAX,
  BUTTON_CODE_PATTERN,
  BUTTON_PRESS_PORT,
  suggestButtonCode,
} from "../../../../../utils/dynaCam";
import {
  TAPO_CREDENTIAL_MAX,
  TAPO_CREDENTIAL_MIN,
  TAPO_DEFAULT_STREAM,
  TAPO_STREAMS,
  buildTapoRtspUrl,
  isRtspUrl,
  isValidIPv4,
} from "../../../../../utils/tapo";
import {
  useGetCourtOptions,
  useCreateCourt,
  useUpdateCourt,
} from "../../../../../services/requests/admin/courts";

const TAPO = "Tapo camera";
const OTHER = "Other RTSP camera";
const CAMERA_TYPE_OPTIONS = [
  { v: TAPO, dot: "var(--color-secondary-color)" },
  { v: OTHER, dot: "var(--color-text-muted)" },
];

const RTSP_MAX = 500; // courts.validator.js caps the URL at 500
const credLength = (v) =>
  v === "" || (v.length >= TAPO_CREDENTIAL_MIN && v.length <= TAPO_CREDENTIAL_MAX);
const credMessage = `Use ${TAPO_CREDENTIAL_MIN}–${TAPO_CREDENTIAL_MAX} characters`;

// The camera is optional (a court can be set up before its camera), and in
// edit mode blank camera fields mean "keep the current one". So every camera
// field validates shape, not presence — except that a Tapo camera needs all
// three of IP, username and password once any of them is filled.
const buildSchema = (isEditMode) =>
  z
    .object({
      venueId: isEditMode
        ? z.string()
        : z.string().min(1, "Choose the venue this court belongs to"),
      name: z
        .string()
        .trim()
        .min(1, "Name is required")
        .max(100, "Name must not exceed 100 characters"),
      cameraType: z.enum([TAPO, OTHER]),
      tapoIp: z
        .string()
        .trim()
        .refine(
          (v) => v === "" || isValidIPv4(v),
          "Enter an IPv4 address, e.g. 192.168.1.50",
        ),
      tapoUsername: z.string().refine(credLength, credMessage),
      tapoPassword: z.string().refine(credLength, credMessage),
      tapoStream: z.enum(TAPO_STREAMS.map((s) => s.value)),
      rtspUrl: z
        .string()
        .trim()
        .max(RTSP_MAX, `Keep the address under ${RTSP_MAX} characters`)
        .refine(
          (v) => v === "" || isRtspUrl(v),
          "Enter the camera's RTSP address, starting with rtsp://",
        ),
      removeCamera: z.boolean(),
      // Optional; unique across all courts (the API answers 409 on a clash)
      buttonCode: z
        .string()
        .trim()
        .refine(
          (v) => v === "" || BUTTON_CODE_PATTERN.test(v),
          "Use 3–32 letters, digits, - or _",
        ),
      status: z.enum(["Active", "Inactive"]),
    })
    .superRefine((v, ctx) => {
      if (v.removeCamera || v.cameraType !== TAPO) return;
      const fields = ["tapoIp", "tapoUsername", "tapoPassword"];
      const filled = fields.filter((f) => v[f] !== "");
      if (filled.length === 0 || filled.length === fields.length) return;
      fields
        .filter((f) => v[f] === "")
        .forEach((f) =>
          ctx.addIssue({
            code: "custom",
            path: [f],
            message: "Needed to set up the Tapo camera",
          }),
        );
    });

const EMPTY = {
  venueId: "",
  name: "",
  cameraType: TAPO,
  tapoIp: "",
  tapoUsername: "",
  tapoPassword: "",
  tapoStream: TAPO_DEFAULT_STREAM,
  rtspUrl: "",
  removeCamera: false,
  buttonCode: "",
  status: "Active",
};

/**
 * The camera URL to send, or "" to send none (create: no camera; edit: keep
 * the current one). Only built when the user actually entered a camera.
 */
const cameraUrlFrom = (values) => {
  if (values.removeCamera) return "";
  if (values.cameraType === OTHER) return values.rtspUrl.trim();
  if (!values.tapoIp || !values.tapoUsername || !values.tapoPassword) return "";
  return buildTapoRtspUrl({
    ip: values.tapoIp,
    username: values.tapoUsername,
    password: values.tapoPassword,
    stream: values.tapoStream,
  });
};

const iconPrefix = "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2";
const mutedIcon = { color: "var(--color-text-muted)" };

const CourtFormDrawer = ({ open, onClose, onSuccess, entity = null }) => {
  const isEditMode = !!entity;
  const req = <span style={{ color: "var(--color-error)" }}>*</span>;

  const schema = useMemo(() => buildSchema(isEditMode), [isEditMode]);
  const form = useForm({ resolver: zodResolver(schema), defaultValues: EMPTY });
  const {
    formState: { isDirty, isSubmitSuccessful },
  } = form;
  const [cameraType, removeCamera, watchedVenueId, watchedName, buttonCode] =
    useWatch({
      control: form.control,
      name: ["cameraType", "removeCamera", "venueId", "name", "buttonCode"],
    });

  // Same query as the Courts page filter, so it is usually already cached
  const { data: optionsData, isLoading: venuesLoading } = useGetCourtOptions({
    enabled: open && !isEditMode,
  });
  const venueOptions = useMemo(
    () =>
      (optionsData?.data?.venues || []).map((v) => ({
        value: v.venueId,
        label: decodeHTML(v.name),
        hint: v.status === "Active" ? undefined : v.status,
      })),
    [optionsData],
  );

  // Hydrate on open. Camera fields always start blank: the stored URL is
  // write-only, and blank means "keep it".
  useEffect(() => {
    if (!open) return;
    form.reset(
      entity
        ? {
            ...EMPTY,
            venueId: entity.venueId ?? "",
            name: decodeHTML(entity.name) ?? "",
            buttonCode: entity.buttonCode ?? "",
            status: entity.status === "Inactive" ? "Inactive" : "Active",
          }
        : EMPTY,
    );
  }, [open, entity, form]);

  const venueNameForCode = isEditMode
    ? decodeHTML(entity?.venueName)
    : venueOptions.find((o) => o.value === watchedVenueId)?.label || "";

  const handleGenerateCode = () => {
    form.setValue("buttonCode", suggestButtonCode(venueNameForCode, watchedName), {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  const createMutation = useCreateCourt();
  const updateMutation = useUpdateCourt();
  const isPending = createMutation.isPending || updateMutation.isPending;
  const saveDisabled = isEditMode && !isDirty;

  const handleClose = () => {
    form.reset(EMPTY);
    onClose();
  };

  const { guardedClose, markSaved } = useDiscardGuard({
    open,
    isDirty,
    isSubmitSuccessful,
    noun: "court",
    onClose: handleClose,
    label: "CourtFormDrawer",
  });

  const setRemoveCamera = (next) => {
    form.setValue("removeCamera", next, { shouldDirty: true });
    if (next) {
      // Nothing typed should be sent alongside a removal
      ["tapoIp", "tapoUsername", "tapoPassword", "rtspUrl"].forEach((f) =>
        form.setValue(f, "", { shouldValidate: false }),
      );
      form.clearErrors();
    }
  };

  const onSubmit = async (values) => {
    const cameraRtspUrl = cameraUrlFrom(values);
    if (cameraRtspUrl.length > RTSP_MAX) {
      form.setError("tapoPassword", {
        message: "The camera address is too long — shorten the username or password",
      });
      return;
    }

    try {
      if (isEditMode) {
        await updateMutation.mutateAsync({
          courtId: entity.courtId,
          courtData: {
            name: values.name,
            status: values.status,
            removeCamera: values.removeCamera,
            // PUT is a full update for the code: "" clears it, so always send it
            buttonCode: values.buttonCode,
            // Omitted = keep the stored camera (the URL is write-only)
            ...(cameraRtspUrl ? { cameraRtspUrl } : {}),
          },
        });
      } else {
        await createMutation.mutateAsync({
          venueId: values.venueId,
          name: values.name,
          ...(values.buttonCode ? { buttonCode: values.buttonCode } : {}),
          ...(cameraRtspUrl ? { cameraRtspUrl } : {}),
        });
      }
      markSaved();
      onSuccess?.();
    } catch (error) {
      // mutation errors already surface a toast via onError
      console.error("Form submission error:", error);
    }
  };

  const camera = entity?.camera;
  const cameraLocked = isEditMode && removeCamera;
  const keepHint = isEditMode
    ? " Leave blank to keep the current camera."
    : " Leave blank to add the camera later.";

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) guardedClose();
      }}
    >
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full gap-0 p-0 sm:max-w-200"
        style={{ background: "var(--color-surface)" }}
      >
        <SheetTitle className="sr-only">
          {isEditMode ? "Edit Court" : "Create New Court"}
        </SheetTitle>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            autoComplete="off"
            className="flex h-full flex-col"
          >
            <div className="flex-1 overflow-y-auto p-6">
              {/* Header — accent chip + title + subtitle + bordered X */}
              <div className="flex items-start justify-between gap-3 mb-7">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="inline-flex items-center justify-center w-11 h-11 rounded-xl shrink-0 bg-(image:--gradient-primary)">
                    <Radio className="w-5.5 h-5.5 text-white" />
                  </span>
                  <div className="min-w-0">
                    <h2
                      className="m-0 font-semibold leading-tight"
                      style={{ fontSize: 19, color: "var(--color-text-dark)" }}
                    >
                      {isEditMode ? "Edit Court" : "Create New Court"}
                    </h2>
                    <p
                      className="m-0 mt-0.5"
                      style={{
                        fontSize: 13,
                        color: "var(--color-text-secondary)",
                      }}
                    >
                      {isEditMode
                        ? "Update the court and its camera"
                        : "Add a court and the camera that films it"}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={guardedClose}
                  aria-label="Close"
                  className="inline-flex items-center justify-center shrink-0 transition-colors hover:bg-(--color-surface-sunken)"
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    border: "1px solid var(--color-line)",
                    color: "var(--color-text-secondary)",
                  }}
                >
                  <X className="w-4.5 h-4.5" />
                </button>
              </div>

              {/* Court details */}
              <SectionLabel>Court details</SectionLabel>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start mb-5">
                {isEditMode ? (
                  <FormItem>
                    <FormLabel>Venue</FormLabel>
                    <div className="relative">
                      <MapPin className={iconPrefix} style={mutedIcon} />
                      <Input
                        value={decodeHTML(entity.venueName)}
                        disabled
                        readOnly
                        className="h-10 pl-9"
                      />
                    </div>
                  </FormItem>
                ) : (
                  <FormField
                    control={form.control}
                    name="venueId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Venue {req}</FormLabel>
                        <FormControl>
                          <SearchableSelect
                            value={field.value || undefined}
                            onValueChange={field.onChange}
                            options={venueOptions}
                            placeholder={
                              venuesLoading ? "Loading venues…" : "Select venue"
                            }
                            emptyText="No venue matches that."
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Court name {req}</FormLabel>
                      <div className="relative">
                        <Radio className={iconPrefix} style={mutedIcon} />
                        <FormControl>
                          <Input
                            placeholder="e.g., Court 1"
                            className="h-10 pl-9"
                            maxLength={100}
                            {...field}
                          />
                        </FormControl>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Camera */}
              <div className="mt-7">
                <SectionLabel>Camera</SectionLabel>

                {/* Edit: what is stored now (credentials stripped) + Remove */}
                {isEditMode && (
                  <div
                    className="flex items-center justify-between gap-3 flex-wrap mb-5 px-3.5 py-3"
                    style={{
                      border: "1px solid var(--color-line)",
                      borderRadius: 10,
                      background: "var(--color-surface-sunken)",
                    }}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {camera?.configured && !removeCamera ? (
                        <Video
                          className="w-4 h-4 shrink-0"
                          style={{ color: "var(--color-secondary-color)" }}
                        />
                      ) : (
                        <VideoOff className="w-4 h-4 shrink-0" style={mutedIcon} />
                      )}
                      <div className="min-w-0">
                        <div
                          style={{ fontSize: 13, color: "var(--color-text-secondary)" }}
                        >
                          {removeCamera
                            ? "The camera will be removed when you save"
                            : camera?.configured
                              ? "Current camera"
                              : "No camera set yet"}
                        </div>
                        {camera?.configured && !removeCamera && (
                          <div
                            className="font-mono truncate"
                            style={{ fontSize: 12.5, color: "var(--color-text-dark)" }}
                            title={camera.display || undefined}
                          >
                            {camera.display ||
                              "Set, but can't be read — enter it again"}
                          </div>
                        )}
                      </div>
                    </div>
                    {camera?.configured &&
                      (removeCamera ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setRemoveCamera(false)}
                        >
                          <Undo2 />
                          Keep camera
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setRemoveCamera(true)}
                        >
                          <VideoOff />
                          Remove camera
                        </Button>
                      ))}
                  </div>
                )}

                {!cameraLocked && (
                  <>
                    <FormField
                      control={form.control}
                      name="cameraType"
                      render={({ field }) => (
                        <FormItem className="mb-5">
                          <FormLabel>
                            {isEditMode ? "New camera type" : "Camera type"}
                          </FormLabel>
                          <StatusToggle
                            value={field.value}
                            onChange={(next) => {
                              if (next === field.value) return;
                              field.onChange(next);
                              // The hidden type's fields are not sent — clear
                              // them so their errors can't block the save
                              const hidden =
                                next === TAPO
                                  ? ["rtspUrl"]
                                  : ["tapoIp", "tapoUsername", "tapoPassword"];
                              hidden.forEach((f) => form.setValue(f, ""));
                              form.clearErrors(hidden);
                            }}
                            options={CAMERA_TYPE_OPTIONS}
                          />
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {cameraType === TAPO ? (
                      <>
                        <p
                          className="m-0 mb-4"
                          style={{
                            fontSize: 12.5,
                            color: "var(--color-text-secondary)",
                          }}
                        >
                          Use the Camera Account from the Tapo app (Camera
                          settings → Advanced settings → Camera Account), not
                          your Tapo login. {TAPO_CREDENTIAL_MIN}–
                          {TAPO_CREDENTIAL_MAX} characters each.
                          {keepHint}
                        </p>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start mb-5">
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
                                <Select
                                  value={field.value}
                                  onValueChange={field.onChange}
                                >
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
                                      // not the admin's own login — keep
                                      // the browser from autofilling it
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
                          <FormItem className="mb-5">
                            <FormLabel>
                              {isEditMode ? "New camera address" : "Camera address"}
                            </FormLabel>
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
                              The camera&apos;s RTSP stream. It is stored
                              encrypted and never shown again in full.
                              {keepHint}
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
                  </>
                )}
              </div>

              {/* Court button */}
              <div className="mt-7">
                <SectionLabel>Court button</SectionLabel>
                <FormField
                  control={form.control}
                  name="buttonCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Button code</FormLabel>
                      <div className="flex items-start gap-2">
                        <div className="relative flex-1 min-w-0">
                          <Keyboard className={iconPrefix} style={mutedIcon} />
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
                        <Button
                          type="button"
                          variant="outline"
                          className="h-10 shrink-0"
                          onClick={handleGenerateCode}
                        >
                          <WandSparkles />
                          Generate
                        </Button>
                      </div>
                      <FormDescription>
                        Optional. Set the court&apos;s Wi-Fi button to call{" "}
                        <span className="font-mono break-all">
                          http://&lt;recorder-box-address&gt;:{BUTTON_PRESS_PORT}
                          /press/{buttonCode?.trim() || "<code>"}
                        </span>{" "}
                        — see the recorder box guide.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Status — edit only; a new court starts Active */}
              {isEditMode && (
                <div className="mt-7">
                  <SectionLabel>Court status</SectionLabel>
                  <FormField
                    control={form.control}
                    name="status"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Status {req}</FormLabel>
                        <StatusToggle
                          value={field.value}
                          onChange={field.onChange}
                        />
                        <FormDescription>
                          While Inactive, the court&apos;s QR code shows as not
                          valid.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}
            </div>

            {/* Footer — hairline top border; Cancel + inverted primary */}
            <div
              className="flex justify-end gap-3 p-6 pt-5"
              style={{
                borderTop: "1px solid var(--color-line)",
                paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))",
              }}
            >
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={guardedClose}
              >
                Cancel
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Button
                      type="submit"
                      size="lg"
                      disabled={saveDisabled || isPending}
                    >
                      {isPending ? <Loader2 className="animate-spin" /> : <Plus />}
                      {isEditMode ? "Update Court" : "Create Court"}
                    </Button>
                  </span>
                </TooltipTrigger>
                {saveDisabled && (
                  <TooltipContent>No changes to save yet</TooltipContent>
                )}
              </Tooltip>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
};

export default CourtFormDrawer;
