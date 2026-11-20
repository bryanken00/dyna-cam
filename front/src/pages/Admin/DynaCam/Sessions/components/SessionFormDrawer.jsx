import { useEffect, useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Film, Loader2, Mail, Phone, Plus, User, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

import GameTimeFields from "../../../../../components/GameTimeFields";
import SearchableSelect from "../../../../../components/SearchableSelect";
import SectionLabel from "../../../../../components/SectionLabel";
import { useDiscardGuard } from "../../../../../hooks/useDiscardGuard";
import { decodeHTML } from "../../../../../utils/decode-html";
import {
  DEFAULT_GAME_MINUTES,
  SESSION_MAX_MINUTES,
  SESSION_MIN_MINUTES,
} from "../../../../../utils/dynaCam";
import {
  fromGameMinutes,
  gameTimeFields,
  toGameMinutes,
} from "../../../../../utils/gameTime";
import {
  PHONE_MAX_LENGTH,
  PHONE_PLACEHOLDER,
  formatPhoneOnChange,
  zPhone,
} from "../../../../../utils/phoneFormat";
import { useGetClipOptions } from "../../../../../services/requests/admin/clips";
import { useCreateSession } from "../../../../../services/requests/admin/sessions";

// CR-016: a game is a court (+ optional player) and a game time. It records
// from Create game — no device needed — and stops by itself when the time is up.
const gameSchema = z
  .object({
    courtId: z.string().min(1, "Choose the court to record"),
    ...gameTimeFields,
    playerName: z.string().trim().max(100, "Keep the name under 100 characters"),
    phone: zPhone,
    // CR-018: optional — gets the game's Google Drive link once it's in Drive and paid
    email: z
      .string()
      .trim()
      .max(255, "Keep the email under 255 characters")
      .refine((v) => v === "" || z.string().email().safeParse(v).success, "Enter a valid email"),
    // CR-015: no payment at the desk — the player gets the videos at once
    free: z.boolean(),
    // CR-013: how many saves the courtside device may hold for this game
    maxCaptures: z
      .string()
      .trim()
      .refine((v) => /^\d+$/.test(v), "Enter a whole number")
      .refine((v) => Number(v) >= 1 && Number(v) <= 20, "From 1 to 20 saves"),
  })
  // Same limits as the API: 5 min to 3 h (Add time can go further later)
  .superRefine((values, ctx) => {
    const total = toGameMinutes(values);
    if (total < SESSION_MIN_MINUTES) {
      ctx.addIssue({
        code: "custom",
        path: ["minutes"],
        message: `A game is at least ${SESSION_MIN_MINUTES} minutes`,
      });
    } else if (total > SESSION_MAX_MINUTES) {
      ctx.addIssue({
        code: "custom",
        path: ["hours"],
        message: "At most 3 hours — add more time while it records",
      });
    }
  });

/** One-tap game times, in minutes. */
const GAME_TIME_PRESETS = [30, 60, 90, 120, 180];

/** Saves per game unless staff change it (the API's default too). */
const DEFAULT_MAX_SAVES = "5";

const emptyValues = () => ({
  courtId: "",
  ...fromGameMinutes(DEFAULT_GAME_MINUTES),
  playerName: "",
  phone: "",
  email: "",
  free: false,
  maxCaptures: DEFAULT_MAX_SAVES,
});

const iconPrefix =
  "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2";
const mutedIcon = { color: "var(--color-text-muted)" };

/**
 * New game (CR-016): a court, a game time and, optionally, the player. The
 * game records from Create game and stops by itself when the time is up; End
 * game on the device (or End here) stops it early, Add time gives it more.
 * Create only. On success `onSuccess` receives `{ sessionId, shareUrl,
 * courtName, venueName, startAt, endAt, playerName }` so the page can go
 * straight on to pairing the court's device.
 */
const SessionFormDrawer = ({ open, onClose, onSuccess }) => {
  const req = <span style={{ color: "var(--color-error)" }}>*</span>;

  const form = useForm({
    resolver: zodResolver(gameSchema),
    defaultValues: emptyValues(),
    // A wrong phone / email shows as soon as staff leave the field, then
    // clears while they fix it — not only on Create game
    mode: "onTouched",
  });
  const {
    formState: { isDirty, isSubmitSuccessful },
  } = form;
  const courtId = useWatch({ control: form.control, name: "courtId" });

  // A fresh form each time the drawer opens
  useEffect(() => {
    if (open) form.reset(emptyValues());
  }, [open, form]);

  // Courts that can record now (court and venue Active)
  const { data: optionsData, isLoading: optionsLoading } = useGetClipOptions();
  const courts = useMemo(
    () => (optionsData?.data?.courts || []).filter((c) => c.active !== false),
    [optionsData],
  );
  const courtOptions = useMemo(
    () =>
      courts.map((c) => ({
        value: c.courtId,
        label: decodeHTML(c.name),
        hint: decodeHTML(c.venueName),
      })),
    [courts],
  );

  const createMutation = useCreateSession();
  const isPending = createMutation.isPending;

  const handleClose = () => {
    form.reset(emptyValues());
    onClose();
  };

  const { guardedClose, markSaved } = useDiscardGuard({
    open,
    isDirty,
    isSubmitSuccessful,
    noun: "game",
    onClose: handleClose,
    label: "SessionFormDrawer",
  });

  const onSubmit = async (values) => {
    const court = courts.find((c) => c.courtId === values.courtId);
    try {
      const response = await createMutation.mutateAsync({
        courtId: values.courtId,
        startNow: true,
        durationMinutes: toGameMinutes(values),
        playerName: values.playerName || null,
        phone: values.phone || null,
        email: values.email || null,
        free: values.free,
        maxCaptures: Number(values.maxCaptures),
      });
      markSaved();
      onSuccess?.({
        sessionId: response?.data?.sessionId,
        shareUrl: response?.data?.shareUrl,
        courtName: decodeHTML(court?.name),
        venueName: decodeHTML(court?.venueName),
        startAt: response?.data?.startAt,
        endAt: response?.data?.endAt,
        playerName: values.playerName,
      });
    } catch (error) {
      // mutation errors already surface a toast via onError (409 = court busy)
      console.error("Form submission error:", error);
    }
  };

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
        <SheetTitle className="sr-only">New game</SheetTitle>

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
                    <Plus className="w-5.5 h-5.5 text-white" />
                  </span>
                  <div className="min-w-0">
                    <h2
                      className="m-0 font-semibold leading-tight"
                      style={{ fontSize: 19, color: "var(--color-text-dark)" }}
                    >
                      New game
                    </h2>
                    <p
                      className="m-0 mt-0.5"
                      style={{
                        fontSize: 13,
                        color: "var(--color-text-secondary)",
                      }}
                    >
                      Recording starts now and stops by itself when the game
                      time is up — pair the court&apos;s device next
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

              {/* Court */}
              <SectionLabel>Court</SectionLabel>
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
                      {courtId
                        ? "The court needs a camera, and its recorder box must be online. One game per court at a time."
                        : "Only active courts are listed."}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* CR-016: how long it records — minutes only is fine */}
              <div className="mt-7">
                <SectionLabel>Game time</SectionLabel>
                <GameTimeFields form={form} presets={GAME_TIME_PRESETS} />
                <p
                  className="m-0 mt-3"
                  style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}
                >
                  5 minutes to 3 hours. Recording stops by itself at the end —
                  staff can add time while it records.
                </p>
              </div>

              {/* Player */}
              <div className="mt-7">
                <SectionLabel>Player</SectionLabel>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                  <FormField
                    control={form.control}
                    name="playerName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Name</FormLabel>
                        <div className="relative">
                          <User className={iconPrefix} style={mutedIcon} />
                          <FormControl>
                            <Input
                              placeholder="e.g., Juan dela Cruz"
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
                  <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone number</FormLabel>
                        <div className="relative">
                          <Phone className={iconPrefix} style={mutedIcon} />
                          <FormControl>
                            <Input
                              placeholder={PHONE_PLACEHOLDER}
                              className="h-10 pl-9"
                              maxLength={PHONE_MAX_LENGTH}
                              inputMode="tel"
                              {...field}
                              onChange={(e) =>
                                field.onChange(formatPhoneOnChange(e.target.value))
                              }
                            />
                          </FormControl>
                        </div>
                        <FormDescription>
                          11 digits starting with 09, e.g. {PHONE_PLACEHOLDER}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {/* CR-018: the game's Google Drive link is emailed here */}
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem className="sm:col-span-2">
                        <FormLabel>Email</FormLabel>
                        <div className="relative">
                          <Mail className={iconPrefix} style={mutedIcon} />
                          <FormControl>
                            <Input
                              type="email"
                              inputMode="email"
                              autoCapitalize="none"
                              placeholder="e.g., juan@gmail.com"
                              className="h-10 pl-9"
                              maxLength={255}
                              {...field}
                            />
                          </FormControl>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <p
                  className="m-0 mt-3"
                  style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}
                >
                  Optional — the name shows on the player&apos;s page. The email
                  gets the game&apos;s Google Drive link once its videos are in
                  Drive and the game is paid.
                </p>
              </div>

              {/* CR-013: saves from the courtside device ("Save the last …") */}
              <div className="mt-7">
                <SectionLabel>Saves</SectionLabel>
                <FormField
                  control={form.control}
                  name="maxCaptures"
                  render={({ field }) => (
                    <FormItem className="sm:max-w-60">
                      <FormLabel>Maximum saves</FormLabel>
                      <div className="relative">
                        <Film className={iconPrefix} style={mutedIcon} />
                        <FormControl>
                          <Input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={20}
                            step={1}
                            className="h-10 pl-9"
                            {...field}
                          />
                        </FormControl>
                      </div>
                      <FormDescription>
                        How many &ldquo;Save the last …&rdquo; videos players can keep from the
                        court&apos;s device. 1 to 20.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* CR-015: paid at the desk (default) or free */}
              <div className="mt-7">
                <SectionLabel>Payment</SectionLabel>
                <FormField
                  control={form.control}
                  name="free"
                  render={({ field }) => (
                    <FormItem>
                      <label
                        htmlFor="game-free"
                        className="flex items-start gap-3 p-3.5 cursor-pointer"
                        style={{
                          border: "1px solid var(--color-line)",
                          borderRadius: 10,
                        }}
                      >
                        <FormControl>
                          <Checkbox
                            id="game-free"
                            className="mt-0.5"
                            checked={field.value}
                            onCheckedChange={(v) => field.onChange(v === true)}
                          />
                        </FormControl>
                        <span className="min-w-0">
                          <span
                            className="block font-medium"
                            style={{ fontSize: 14, color: "var(--color-text-dark)" }}
                          >
                            Free game
                          </span>
                          <span
                            className="block mt-0.5"
                            style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}
                          >
                            {field.value
                              ? "No payment — the court's device shows the download QR and the player's page opens right away."
                              : "Off: the player pays at the front desk with the game's code before getting the videos."}
                          </span>
                        </span>
                      </label>
                    </FormItem>
                  )}
                />
              </div>
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
              <Button type="submit" size="lg" disabled={isPending}>
                {isPending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Plus />
                )}
                Create game
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
};

export default SessionFormDrawer;
