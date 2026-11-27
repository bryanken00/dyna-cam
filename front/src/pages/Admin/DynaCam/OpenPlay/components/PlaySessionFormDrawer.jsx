import { useEffect, useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Loader2, Save, Users, X } from "lucide-react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

import DatePicker from "../../../../../components/DatePicker";
import PickChip from "../../../../../components/PickChip";
import SectionLabel from "../../../../../components/SectionLabel";
import { useDiscardGuard } from "../../../../../hooks/useDiscardGuard";
import { decodeHTML } from "../../../../../utils/decode-html";
import { manilaNow } from "../../../../../utils/dynaCam";
import { NOT_SAID, SKILL_LEVELS } from "../../../../../utils/venueFacts";
import {
  useCreatePlaySession,
  useGetOpenPlayOptions,
  useGetPlaySession,
  useUpdatePlaySession,
} from "../../../../../services/requests/admin/openPlay";

const DAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

// Mirrors createPlaySessionSchema / updatePlaySessionSchema
const schema = z
  .object({
    venueId: z.string().min(1, "Pick a venue"),
    // PLAN-009 phase F: a coached clinic, and a club's members only
    kind: z.enum(["OpenPlay", "Clinic"]),
    coachName: z.string().trim().max(100),
    clubId: z.string(),
    title: z.string().trim().min(1, "Give the session a name").max(100),
    description: z.string().trim().max(500, "Keep it under 500 characters"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date"),
    startTime: z.string().regex(/^\d{2}:\d{2}$/, "Pick the start time"),
    endTime: z.string().regex(/^\d{2}:\d{2}$/, "Pick the end time"),
    courtIds: z.array(z.string()).min(1, "Pick at least one court"),
    minLevel: z.string(),
    maxLevel: z.string(),
    capacity: z
      .string()
      .trim()
      .regex(/^\d+$/, "Enter a whole number of players")
      .refine((v) => Number(v) >= 2 && Number(v) <= 200, "Between 2 and 200 players"),
    pricePerHead: z
      .string()
      .trim()
      .regex(/^\d+(\.\d{1,2})?$/, "Enter an amount like 150 or 149.50")
      .refine((v) => Number(v) <= 100000, "The fee is too high"),
    repeat: z.boolean(),
    daysOfWeek: z.array(z.number()),
    endsOn: z.string(),
  })
  .superRefine((v, ctx) => {
    // "00:00" as the end = midnight, the end of the day
    if (v.endTime !== "00:00" && v.endTime <= v.startTime) {
      ctx.addIssue({ code: "custom", path: ["endTime"], message: "The session must end after it starts" });
    }
    if (v.minLevel !== NOT_SAID && v.maxLevel !== NOT_SAID && SKILL_LEVELS.indexOf(v.minLevel) > SKILL_LEVELS.indexOf(v.maxLevel)) {
      ctx.addIssue({ code: "custom", path: ["maxLevel"], message: "The highest level can't be below the lowest" });
    }
    if (v.repeat && v.daysOfWeek.length === 0) {
      ctx.addIssue({ code: "custom", path: ["daysOfWeek"], message: "Pick at least one day" });
    }
    if (v.repeat && v.endsOn && v.endsOn < v.date) {
      ctx.addIssue({ code: "custom", path: ["endsOn"], message: "The last date must be on or after the first" });
    }
  });

const emptyValues = (venueId = "") => ({
  venueId,
  kind: "OpenPlay",
  coachName: "",
  clubId: NOT_SAID,
  title: "Open Play",
  description: "",
  date: manilaNow().date,
  startTime: "18:00",
  endTime: "21:00",
  courtIds: [],
  minLevel: NOT_SAID,
  maxLevel: NOT_SAID,
  capacity: "16",
  pricePerHead: "0",
  repeat: false,
  daysOfWeek: [],
  endsOn: "",
});

const fromSession = (s) => ({
  venueId: s.venueId,
  kind: s.kind || "OpenPlay",
  coachName: decodeHTML(s.coachName || ""),
  clubId: s.clubId || NOT_SAID,
  title: decodeHTML(s.title),
  description: decodeHTML(s.description || ""),
  date: s.startAt.slice(0, 10),
  startTime: s.startAt.slice(11, 16),
  endTime: s.endAt.slice(11, 16),
  courtIds: (s.courts || []).map((c) => c.courtId),
  minLevel: s.minLevel || NOT_SAID,
  maxLevel: s.maxLevel || NOT_SAID,
  capacity: String(s.capacity),
  pricePerHead: String(Number(s.pricePerHead) || 0),
  repeat: false,
  daysOfWeek: [],
  endsOn: "",
});

const req = <span style={{ color: "var(--color-error)" }}>*</span>;

/** A level select with "Any". */
const LevelField = ({ control, name, label }) => (
  <FormField
    control={control}
    name={name}
    render={({ field }) => (
      <FormItem>
        <FormLabel>{label}</FormLabel>
        <Select value={field.value} onValueChange={field.onChange}>
          <FormControl>
            <SelectTrigger className="h-10 w-full">
              <SelectValue />
            </SelectTrigger>
          </FormControl>
          <SelectContent>
            <SelectItem value={NOT_SAID}>Any</SelectItem>
            {SKILL_LEVELS.map((level) => (
              <SelectItem key={level} value={level}>
                {level}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FormMessage />
      </FormItem>
    )}
  />
);

/**
 * PLAN-009 phase C — add an Open Play session (once, or every week), or change
 * one that hasn't ended. `entity`: a session row from the list (edit) or null.
 */
const PlaySessionFormDrawer = ({ open, onClose, onSuccess, entity = null }) => {
  const isEditMode = !!entity?.playSessionId;
  const { data: optionsData } = useGetOpenPlayOptions();
  const venues = useMemo(() => optionsData?.data?.venues || [], [optionsData]);
  const { data: detail, isLoading: loadingDetail } = useGetPlaySession(open && isEditMode ? entity.playSessionId : null);
  const createMutation = useCreatePlaySession();
  const updateMutation = useUpdatePlaySession();
  const isPending = createMutation.isPending || updateMutation.isPending;

  const form = useForm({ resolver: zodResolver(schema), defaultValues: emptyValues() });
  const {
    formState: { isDirty, isSubmitSuccessful },
  } = form;
  const [venueId, repeat, courtIds, kind] = useWatch({ control: form.control, name: ["venueId", "repeat", "courtIds", "kind"] });
  const venue = venues.find((v) => v.venueId === venueId);
  const courts = venue?.courts || [];
  const clubs = venue?.clubs || [];

  const session = detail?.data?.session;
  useEffect(() => {
    if (!open) return;
    if (isEditMode) {
      if (session) form.reset(fromSession(session));
    } else {
      form.reset(emptyValues(venues.length === 1 ? venues[0].venueId : ""));
    }
  }, [open, isEditMode, session, venues, form]);

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
    label: "PlaySessionFormDrawer",
  });

  const onSubmit = async (values) => {
    const fields = {
      kind: values.kind,
      coachName: values.kind === "Clinic" ? values.coachName : "",
      clubId: values.clubId === NOT_SAID ? "" : values.clubId,
      title: values.title,
      description: values.description,
      date: values.date,
      startTime: values.startTime,
      endTime: values.endTime === "00:00" ? "24:00" : values.endTime,
      courtIds: values.courtIds,
      minLevel: values.minLevel === NOT_SAID ? "" : values.minLevel,
      maxLevel: values.maxLevel === NOT_SAID ? "" : values.maxLevel,
      capacity: Number(values.capacity),
      pricePerHead: Number(values.pricePerHead),
    };
    try {
      if (isEditMode) {
        await updateMutation.mutateAsync({ playSessionId: entity.playSessionId, body: fields });
      } else {
        await createMutation.mutateAsync({
          venueId: values.venueId,
          ...fields,
          ...(values.repeat ? { repeat: { daysOfWeek: values.daysOfWeek, endsOn: values.endsOn } } : {}),
        });
      }
      markSaved();
      onSuccess?.();
    } catch (error) {
      // the mutation's onError shows the toast
      console.error("Form submission error:", error);
    }
  };

  const toggle = (list, value) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  return (
    <Sheet open={open} onOpenChange={(next) => !next && guardedClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full gap-0 p-0 sm:max-w-200"
        style={{ background: "var(--color-surface)" }}
      >
        <SheetTitle className="sr-only">{isEditMode ? "Edit session" : "New Open Play session"}</SheetTitle>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} autoComplete="off" className="flex h-full flex-col">
            <div className="flex-1 overflow-y-auto p-6">
              <div className="flex items-start justify-between gap-3 mb-7">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="inline-flex items-center justify-center w-11 h-11 rounded-xl shrink-0 bg-(image:--gradient-primary)">
                    <Users className="w-5.5 h-5.5 text-white" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="m-0 font-semibold leading-tight" style={{ fontSize: 19, color: "var(--color-text-dark)" }}>
                      {isEditMode ? "Edit session" : "New Open Play session"}
                    </h2>
                    <p className="m-0 mt-0.5" style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                      {isEditMode
                        ? "Changes apply to this session only. A new fee applies to players who join from now."
                        : "Players join from the app; its courts can't be booked while it runs."}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={guardedClose}
                  aria-label="Close"
                  className="inline-flex items-center justify-center shrink-0 transition-colors hover:bg-(--color-surface-sunken)"
                  style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid var(--color-line)", color: "var(--color-text-secondary)" }}
                >
                  <X className="w-4.5 h-4.5" />
                </button>
              </div>

              {isEditMode && loadingDetail ? (
                <div className="py-16 text-center" style={{ color: "var(--color-text-muted)" }}>
                  <Loader2 className="inline animate-spin" />
                </div>
              ) : (
                <div className="space-y-7">
                  <section>
                    <SectionLabel>Session</SectionLabel>
                    <div className="space-y-5">
                      <FormField
                        control={form.control}
                        name="venueId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Venue {req}</FormLabel>
                            <Select
                              value={field.value}
                              disabled={isEditMode}
                              onValueChange={(v) => {
                                field.onChange(v);
                                form.setValue("courtIds", [], { shouldDirty: true });
                                form.setValue("clubId", NOT_SAID, { shouldDirty: true });
                              }}
                            >
                              <FormControl>
                                <SelectTrigger className="h-10 w-full">
                                  <SelectValue placeholder="Pick a venue" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {venues.map((v) => (
                                  <SelectItem key={v.venueId} value={v.venueId}>
                                    {decodeHTML(v.name)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <div className="grid gap-5 sm:grid-cols-2">
                        <FormField
                          control={form.control}
                          name="kind"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Type</FormLabel>
                              <Select value={field.value} onValueChange={field.onChange} disabled={isEditMode}>
                                <FormControl>
                                  <SelectTrigger className="h-10 w-full">
                                    <SelectValue />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="OpenPlay">Open Play</SelectItem>
                                  <SelectItem value="Clinic">Clinic (coached)</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="clubId"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Who can join</FormLabel>
                              <Select value={field.value} onValueChange={field.onChange}>
                                <FormControl>
                                  <SelectTrigger className="h-10 w-full">
                                    <SelectValue />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value={NOT_SAID}>Anyone</SelectItem>
                                  {clubs.map((c) => (
                                    <SelectItem key={c.clubId} value={c.clubId}>
                                      Members of {decodeHTML(c.name)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      {kind === "Clinic" && (
                        <FormField
                          control={form.control}
                          name="coachName"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Coach</FormLabel>
                              <FormControl>
                                <Input placeholder="e.g., Coach Rina" className="h-10" maxLength={100} {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      )}
                      <FormField
                        control={form.control}
                        name="title"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Name {req}</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g., Evening Open Play" className="h-10" maxLength={100} {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="description"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              Notes for players <span style={{ color: "var(--color-text-muted)" }}>(optional)</span>
                            </FormLabel>
                            <FormControl>
                              <Textarea rows={2} maxLength={500} placeholder="e.g., Bring your own paddle — balls provided" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </section>

                  <section>
                    <SectionLabel>When and where</SectionLabel>
                    <div className="grid gap-5 sm:grid-cols-3">
                      <FormField
                        control={form.control}
                        name="date"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{repeat ? "First date" : "Date"} {req}</FormLabel>
                            <FormControl>
                              <DatePicker className="w-full" min={manilaNow().date} {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="startTime"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Starts {req}</FormLabel>
                            <FormControl>
                              <Input type="time" step={900} className="h-10" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="endTime"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Ends {req}</FormLabel>
                            <FormControl>
                              <Input type="time" step={900} className="h-10" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <FormField
                      control={form.control}
                      name="courtIds"
                      render={() => (
                        <FormItem className="mt-5">
                          <FormLabel>Courts {req}</FormLabel>
                          {courts.length === 0 ? (
                            <FormDescription>{venueId ? "This venue has no courts in use." : "Pick a venue first."}</FormDescription>
                          ) : (
                            <div className="flex flex-wrap gap-2" role="group" aria-label="Courts">
                              {courts.map((c) => (
                                <PickChip
                                  key={c.courtId}
                                  selected={courtIds.includes(c.courtId)}
                                  className="px-3 h-9 text-[13.5px]"
                                  onClick={() =>
                                    form.setValue("courtIds", toggle(courtIds, c.courtId), {
                                      shouldDirty: true,
                                      shouldValidate: true,
                                    })
                                  }
                                >
                                  {decodeHTML(c.name)}
                                </PickChip>
                              ))}
                            </div>
                          )}
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {!isEditMode && (
                      <div className="mt-5 space-y-4">
                        <FormField
                          control={form.control}
                          name="repeat"
                          render={({ field }) => (
                            <FormItem className="flex items-center gap-2.5 space-y-0">
                              <FormControl>
                                <Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(v === true)} />
                              </FormControl>
                              <FormLabel className="m-0 cursor-pointer">Repeat every week</FormLabel>
                            </FormItem>
                          )}
                        />
                        {repeat && (
                          <div className="grid gap-5 sm:grid-cols-[1fr_200px]">
                            <FormField
                              control={form.control}
                              name="daysOfWeek"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>On {req}</FormLabel>
                                  <div className="flex flex-wrap gap-2" role="group" aria-label="Days">
                                    {DAYS.map((d) => (
                                      <PickChip
                                        key={d.value}
                                        selected={field.value.includes(d.value)}
                                        className="px-3 h-9 text-[13.5px]"
                                        onClick={() => field.onChange(toggle(field.value, d.value))}
                                      >
                                        {d.label}
                                      </PickChip>
                                    ))}
                                  </div>
                                  <FormDescription>Sessions are added 4 weeks ahead.</FormDescription>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={form.control}
                              name="endsOn"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>
                                    Until <span style={{ color: "var(--color-text-muted)" }}>(optional)</span>
                                  </FormLabel>
                                  <FormControl>
                                    <DatePicker className="w-full" placeholder="No end" min={form.getValues("date")} {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </section>

                  <section>
                    <SectionLabel>Players</SectionLabel>
                    <div className="grid gap-5 sm:grid-cols-2">
                      <LevelField control={form.control} name="minLevel" label="Lowest level" />
                      <LevelField control={form.control} name="maxLevel" label="Highest level" />
                      <FormField
                        control={form.control}
                        name="capacity"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Most players {req}</FormLabel>
                            <FormControl>
                              <Input inputMode="numeric" className="h-10" {...field} />
                            </FormControl>
                            <FormDescription>About 4–6 per court keeps games moving.</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="pricePerHead"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Fee per player (₱) {req}</FormLabel>
                            <FormControl>
                              <Input inputMode="decimal" className="h-10" {...field} />
                            </FormControl>
                            <FormDescription>0 = free. Players pay online when they join.</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </section>
                </div>
              )}
            </div>

            <div
              className="flex justify-end gap-3 p-6 pt-5"
              style={{ borderTop: "1px solid var(--color-line)", paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}
            >
              <Button type="button" variant="outline" size="lg" onClick={guardedClose}>
                Cancel
              </Button>
              <Button type="submit" size="lg" disabled={isPending || (isEditMode && !isDirty)}>
                {isPending ? <Loader2 className="animate-spin" /> : <Save />}
                {isEditMode ? "Save session" : repeat ? "Save weekly series" : "Add session"}
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
};

export default PlaySessionFormDrawer;
