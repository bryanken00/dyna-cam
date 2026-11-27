import { useEffect, useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Loader2, Save, Trophy, X } from "lucide-react";

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
import { Textarea } from "@/components/ui/textarea";

import DatePicker from "../../../../../components/DatePicker";
import PickChip from "../../../../../components/PickChip";
import SectionLabel from "../../../../../components/SectionLabel";
import { useDiscardGuard } from "../../../../../hooks/useDiscardGuard";
import { decodeHTML } from "../../../../../utils/decode-html";
import { manilaNow } from "../../../../../utils/dynaCam";
import {
  useCreateTournament,
  useGetTournamentOptions,
  useUpdateTournament,
} from "../../../../../services/requests/admin/tournaments";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

// Mirrors createTournamentSchema / updateTournamentSchema
const schema = z
  .object({
    venueId: z.string().min(1, "Pick a venue"),
    name: z.string().trim().min(1, "Name the tournament").max(120),
    description: z.string().trim().max(1000),
    startDate: z.string().regex(DATE, "Pick the first day"),
    endDate: z.string().regex(DATE, "Pick the last day"),
    dailyStart: z.string().regex(TIME, "Pick a time"),
    dailyEnd: z.string().regex(TIME, "Pick a time"),
    closesDate: z.string().regex(DATE, "Pick the date"),
    closesTime: z.string().regex(TIME, "Pick the time"),
    courtIds: z.array(z.string()).min(1, "Pick at least one court"),
  })
  .superRefine((v, ctx) => {
    if (v.endDate < v.startDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "The last day can't be before the first" });
    if (v.dailyEnd !== "00:00" && v.dailyEnd <= v.dailyStart) {
      ctx.addIssue({ code: "custom", path: ["dailyEnd"], message: "Must be after the start" });
    }
    if (v.closesDate > v.endDate) {
      ctx.addIssue({ code: "custom", path: ["closesDate"], message: "Registration must close before the tournament ends" });
    }
  });

const empty = (venueId = "") => {
  const today = manilaNow().date;
  return {
    venueId,
    name: "",
    description: "",
    startDate: today,
    endDate: today,
    dailyStart: "08:00",
    dailyEnd: "18:00",
    closesDate: today,
    closesTime: "20:00",
    courtIds: [],
  };
};

const fromTournament = (t) => ({
  venueId: t.venueId,
  name: decodeHTML(t.name),
  description: decodeHTML(t.description || ""),
  startDate: t.startDate,
  endDate: t.endDate,
  dailyStart: t.dailyStart,
  dailyEnd: t.dailyEnd === "24:00" ? "00:00" : t.dailyEnd,
  closesDate: t.registrationClosesAt.slice(0, 10),
  closesTime: t.registrationClosesAt.slice(11, 16),
  courtIds: (t.courts || []).map((c) => c.courtId),
});

const req = <span style={{ color: "var(--color-error)" }}>*</span>;

/**
 * PLAN-009 phase E — add a tournament (Draft), or change one before it's live.
 * `entity`: a tournament from the detail page (edit) or null.
 */
const TournamentFormDrawer = ({ open, onClose, onSuccess, entity = null }) => {
  const isEditMode = !!entity?.tournamentId;
  const { data: optionsData } = useGetTournamentOptions();
  const venues = useMemo(() => optionsData?.data?.venues || [], [optionsData]);
  const createMutation = useCreateTournament();
  const updateMutation = useUpdateTournament();
  const isPending = createMutation.isPending || updateMutation.isPending;

  const form = useForm({ resolver: zodResolver(schema), defaultValues: empty() });
  const {
    formState: { isDirty, isSubmitSuccessful },
  } = form;
  const [venueId, courtIds] = useWatch({ control: form.control, name: ["venueId", "courtIds"] });
  const courts = venues.find((v) => v.venueId === venueId)?.courts || [];

  useEffect(() => {
    if (!open) return;
    form.reset(isEditMode ? fromTournament(entity) : empty(venues.length === 1 ? venues[0].venueId : ""));
  }, [open, isEditMode, entity, venues, form]);

  const handleClose = () => {
    form.reset(empty());
    onClose();
  };
  const { guardedClose, markSaved } = useDiscardGuard({
    open,
    isDirty,
    isSubmitSuccessful,
    noun: "tournament",
    onClose: handleClose,
    label: "TournamentFormDrawer",
  });

  const onSubmit = async (v) => {
    const body = {
      name: v.name,
      description: v.description,
      startDate: v.startDate,
      endDate: v.endDate,
      dailyStart: v.dailyStart,
      dailyEnd: v.dailyEnd === "00:00" ? "24:00" : v.dailyEnd,
      registrationClosesAt: `${v.closesDate} ${v.closesTime}`,
      courtIds: v.courtIds,
    };
    try {
      if (isEditMode) await updateMutation.mutateAsync({ tournamentId: entity.tournamentId, data: body });
      else {
        const res = await createMutation.mutateAsync({ venueId: v.venueId, ...body });
        markSaved();
        onSuccess?.({ tournamentId: res?.data?.tournamentId });
        return;
      }
      markSaved();
      onSuccess?.(null);
    } catch (error) {
      console.error("Form submission error:", error);
    }
  };

  const toggle = (list, value) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  const field = (name, label, render, extra) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field: f }) => (
        <FormItem>
          <FormLabel>
            {label} {req}
          </FormLabel>
          <FormControl>{render(f)}</FormControl>
          {extra && <FormDescription>{extra}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <Sheet open={open} onOpenChange={(next) => !next && guardedClose()}>
      <SheetContent side="right" showCloseButton={false} className="w-full gap-0 p-0 sm:max-w-200" style={{ background: "var(--color-surface)" }}>
        <SheetTitle className="sr-only">{isEditMode ? "Edit tournament" : "New tournament"}</SheetTitle>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} autoComplete="off" className="flex h-full flex-col">
            <div className="flex-1 overflow-y-auto p-6">
              <div className="flex items-start justify-between gap-3 mb-7">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="inline-flex items-center justify-center w-11 h-11 rounded-xl shrink-0 bg-(image:--gradient-primary)">
                    <Trophy className="w-5.5 h-5.5 text-white" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="m-0 font-semibold leading-tight" style={{ fontSize: 19, color: "var(--color-text-dark)" }}>
                      {isEditMode ? "Edit tournament" : "New tournament"}
                    </h2>
                    <p className="m-0 mt-0.5" style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                      Its courts are held for these days and hours — nobody can book them.
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

              <div className="space-y-7">
                <section className="space-y-5">
                  <SectionLabel>Tournament</SectionLabel>
                  <FormField
                    control={form.control}
                    name="venueId"
                    render={({ field: f }) => (
                      <FormItem>
                        <FormLabel>Venue {req}</FormLabel>
                        <Select
                          value={f.value}
                          disabled={isEditMode}
                          onValueChange={(v) => {
                            f.onChange(v);
                            form.setValue("courtIds", [], { shouldDirty: true });
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
                  {field("name", "Name", (f) => <Input placeholder="e.g., Club Doubles Open" className="h-10" maxLength={120} {...f} />)}
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field: f }) => (
                      <FormItem>
                        <FormLabel>
                          About it <span style={{ color: "var(--color-text-muted)" }}>(optional)</span>
                        </FormLabel>
                        <FormControl>
                          <Textarea rows={3} maxLength={1000} placeholder="Prizes, rules, what to bring…" {...f} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </section>

                <section>
                  <SectionLabel>Days and courts</SectionLabel>
                  <div className="grid gap-5 sm:grid-cols-2">
                    {field("startDate", "First day", (f) => <DatePicker className="w-full" min={manilaNow().date} {...f} />)}
                    {field("endDate", "Last day", (f) => <DatePicker className="w-full" min={form.getValues("startDate")} {...f} />)}
                    {field("dailyStart", "Courts held from", (f) => <Input type="time" step={1800} className="h-10" {...f} />)}
                    {field("dailyEnd", "Until", (f) => <Input type="time" step={1800} className="h-10" {...f} />, "Every day of the tournament")}
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
                                  form.setValue("courtIds", toggle(courtIds, c.courtId), { shouldDirty: true, shouldValidate: true })
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
                </section>

                <section>
                  <SectionLabel>Registration closes</SectionLabel>
                  <div className="grid gap-5 sm:grid-cols-2">
                    {field("closesDate", "Date", (f) => <DatePicker className="w-full" {...f} />)}
                    {field("closesTime", "Time", (f) => <Input type="time" step={1800} className="h-10" {...f} />)}
                  </div>
                </section>
              </div>
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
                {isEditMode ? "Save tournament" : "Add tournament"}
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
};

export default TournamentFormDrawer;
