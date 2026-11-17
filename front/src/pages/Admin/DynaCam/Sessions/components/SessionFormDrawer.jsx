import { useEffect, useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import dayjs from "dayjs";
import {
  CalendarPlus,
  Clock,
  Loader2,
  Phone,
  Timer,
  User,
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

import DatePicker from "../../../../../components/DatePicker";
import SearchableSelect from "../../../../../components/SearchableSelect";
import SectionLabel from "../../../../../components/SectionLabel";
import StatusToggle from "../../../../../components/StatusToggle";
import { useDiscardGuard } from "../../../../../hooks/useDiscardGuard";
import { decodeHTML } from "../../../../../utils/decode-html";
import {
  PHONE_MAX_LENGTH,
  PHONE_PLACEHOLDER,
  formatPhoneOnChange,
  zPhone,
} from "../../../../../utils/phoneFormat";
import {
  SESSION_DURATIONS,
  SESSION_MAX_DAYS_AHEAD,
  SESSION_MAX_MINUTES,
  SESSION_MIN_MINUTES,
  formatMinutes,
  manilaNow,
} from "../../../../../utils/dynaCam";
import { useGetClipOptions } from "../../../../../services/requests/admin/clips";
import { useCreateSession } from "../../../../../services/requests/admin/sessions";

const CUSTOM = "custom";
const PART_MINUTES = 5;

// When the session starts — the toggle's labels are its values
const START_NOW = "Start now";
const START_LATER = "Pick date & time";
const START_OPTIONS = [
  { v: START_NOW, dot: "var(--color-success)" },
  { v: START_LATER, dot: "var(--color-text-muted)" },
];

/** The minutes the form stands for, or NaN while the custom value is invalid. */
const minutesOf = (duration, customMinutes) =>
  duration === CUSTOM ? Number(customMinutes) : Number(duration);

// Mirrors sessions.validator.js + the controller's window rules. Times are
// Manila wall-clock ("YYYY-MM-DD HH:mm"), compared as strings against
// manilaNow() so the browser's own zone doesn't matter. With Start now the
// date and time aren't sent, so they aren't checked.
const sessionSchema = z
  .object({
    courtId: z.string().min(1, "Choose the court to record"),
    start: z.enum([START_NOW, START_LATER]),
    date: z.string(),
    time: z.string(),
    duration: z.enum([...SESSION_DURATIONS.map(String), CUSTOM]),
    customMinutes: z.string().trim(),
    playerName: z.string().trim().max(100, "Keep the name under 100 characters"),
    phone: zPhone,
  })
  .superRefine((v, ctx) => {
    if (v.duration === CUSTOM) {
      const m = Number(v.customMinutes);
      if (
        !/^\d+$/.test(v.customMinutes) ||
        m < SESSION_MIN_MINUTES ||
        m > SESSION_MAX_MINUTES
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["customMinutes"],
          message: `Use ${SESSION_MIN_MINUTES}–${SESSION_MAX_MINUTES} whole minutes`,
        });
      }
    }
    if (v.start === START_NOW) return;
    const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(v.date);
    const timeOk = /^([01]\d|2[0-3]):[0-5]\d$/.test(v.time);
    if (!dateOk) {
      ctx.addIssue({ code: "custom", path: ["date"], message: "Pick a date" });
    }
    if (!timeOk) {
      ctx.addIssue({ code: "custom", path: ["time"], message: "Pick a start time" });
    }
    if (!dateOk || !timeOk) return;
    const start = `${v.date} ${v.time}`;
    const earliest = manilaNow(-1);
    const latest = manilaNow(SESSION_MAX_DAYS_AHEAD * 24 * 60);
    if (start < `${earliest.date} ${earliest.time}`) {
      ctx.addIssue({
        code: "custom",
        path: ["time"],
        message: "That time has passed — use Start now or a later time",
      });
    } else if (start > `${latest.date} ${latest.time}`) {
      ctx.addIssue({
        code: "custom",
        path: ["date"],
        message: `Book at most ${SESSION_MAX_DAYS_AHEAD} days ahead`,
      });
    }
  });

/** Next 5-minute mark at least 5 minutes from now (Manila). */
const defaultStart = () => {
  const base = manilaNow(5);
  const minute = Number(base.time.slice(3));
  return manilaNow(5 + ((5 - (minute % 5)) % 5));
};

const emptyValues = () => {
  const start = defaultStart();
  return {
    courtId: "",
    start: START_NOW,
    date: start.date,
    time: start.time,
    duration: "60",
    customMinutes: "",
    playerName: "",
    phone: "",
  };
};

const iconPrefix =
  "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2";
const mutedIcon = { color: "var(--color-text-muted)" };

/**
 * Book a court for a whole-session recording — starting now (the default) or
 * at a picked date and time. Create only (a session can be cancelled, not
 * edited). On success `onSuccess` receives
 * `{ sessionId, shareUrl, startAt, endAt, courtName, venueName, playerName }`
 * so the page can go straight on to pairing a device.
 */
const SessionFormDrawer = ({ open, onClose, onSuccess }) => {
  const req = <span style={{ color: "var(--color-error)" }}>*</span>;

  const form = useForm({
    resolver: zodResolver(sessionSchema),
    defaultValues: emptyValues(),
  });
  const {
    formState: { isDirty, isSubmitSuccessful },
  } = form;
  const [courtId, start, date, time, duration, customMinutes] = useWatch({
    control: form.control,
    name: ["courtId", "start", "date", "time", "duration", "customMinutes"],
  });
  const startNow = start === START_NOW;

  // A fresh default start time each time the drawer opens
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
    noun: "session",
    onClose: handleClose,
    label: "SessionFormDrawer",
  });

  // "Ends 3:30 PM · 18 parts" — display only, the API works out the real end
  const minutes = minutesOf(duration, customMinutes);
  const startsAt = startNow
    ? (() => {
        const now = manilaNow();
        return `${now.date} ${now.time}`;
      })()
    : date && time
      ? `${date} ${time}`
      : null;
  const summary =
    startsAt && Number.isFinite(minutes) && minutes > 0
      ? `${startNow ? "Starts now · ends about" : "Ends"} ${dayjs(startsAt)
          .add(minutes, "minute")
          .format("MMM D, h:mm A")} · ${Math.ceil(minutes / PART_MINUTES)} parts of 5 minutes`
      : null;

  const onSubmit = async (values) => {
    const court = courts.find((c) => c.courtId === values.courtId);
    try {
      const response = await createMutation.mutateAsync({
        courtId: values.courtId,
        ...(values.start === START_NOW
          ? { startNow: true }
          : { startAt: `${values.date} ${values.time}` }),
        durationMinutes: minutesOf(values.duration, values.customMinutes),
        playerName: values.playerName || null,
        phone: values.phone || null,
      });
      markSaved();
      onSuccess?.({
        sessionId: response?.data?.sessionId,
        shareUrl: response?.data?.shareUrl,
        startAt: response?.data?.startAt,
        endAt: response?.data?.endAt,
        courtName: decodeHTML(court?.name),
        venueName: decodeHTML(court?.venueName),
        playerName: values.playerName,
      });
    } catch (error) {
      // mutation errors already surface a toast via onError (409 = overlap)
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
        <SheetTitle className="sr-only">Book a Session</SheetTitle>

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
                    <CalendarPlus className="w-5.5 h-5.5 text-white" />
                  </span>
                  <div className="min-w-0">
                    <h2
                      className="m-0 font-semibold leading-tight"
                      style={{ fontSize: 19, color: "var(--color-text-dark)" }}
                    >
                      Book a Session
                    </h2>
                    <p
                      className="m-0 mt-0.5"
                      style={{
                        fontSize: 13,
                        color: "var(--color-text-secondary)",
                      }}
                    >
                      Record a court for a whole game — the player gets every
                      part on one link
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
                        ? "The court needs a camera, and its recorder box must be online when the session starts."
                        : "Only active courts are listed."}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* When */}
              <div className="mt-7">
                <SectionLabel>When (venue time)</SectionLabel>
                <FormField
                  control={form.control}
                  name="start"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Start {req}</FormLabel>
                      <StatusToggle
                        value={field.value}
                        onChange={field.onChange}
                        options={START_OPTIONS}
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {!startNow && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start mt-5">
                    <FormField
                      control={form.control}
                      name="date"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Date {req}</FormLabel>
                          <FormControl>
                            <DatePicker
                              className="w-full"
                              min={manilaNow().date}
                              max={manilaNow(SESSION_MAX_DAYS_AHEAD * 24 * 60).date}
                              allowClear={false}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="time"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Start time {req}</FormLabel>
                          <div className="relative">
                            <Clock className={iconPrefix} style={mutedIcon} />
                            <FormControl>
                              <Input
                                type="time"
                                step={300}
                                className="h-10 pl-9"
                                {...field}
                              />
                            </FormControl>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start mt-5">
                  <FormField
                    control={form.control}
                    name="duration"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Length {req}</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger className="h-10 w-full">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {SESSION_DURATIONS.map((m) => (
                              <SelectItem key={m} value={String(m)}>
                                {formatMinutes(m)}
                              </SelectItem>
                            ))}
                            <SelectItem value={CUSTOM}>Custom…</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {duration === CUSTOM && (
                    <FormField
                      control={form.control}
                      name="customMinutes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Minutes {req}</FormLabel>
                          <div className="relative">
                            <Timer className={iconPrefix} style={mutedIcon} />
                            <FormControl>
                              <Input
                                type="number"
                                inputMode="numeric"
                                min={SESSION_MIN_MINUTES}
                                max={SESSION_MAX_MINUTES}
                                step={5}
                                placeholder="e.g., 45"
                                className="h-10 pl-9"
                                {...field}
                              />
                            </FormControl>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </div>
                {summary && (
                  <p
                    className="m-0 mt-3"
                    style={{ fontSize: 12.5, color: "var(--color-text-secondary)" }}
                  >
                    {summary}
                  </p>
                )}
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
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <p
                  className="m-0 mt-3"
                  style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}
                >
                  Optional — shown on the player&apos;s page so they know the
                  footage is theirs.
                </p>
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
                  <CalendarPlus />
                )}
                Book Session
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
};

export default SessionFormDrawer;
