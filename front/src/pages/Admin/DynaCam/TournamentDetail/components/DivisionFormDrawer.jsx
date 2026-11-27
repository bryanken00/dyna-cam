import { useEffect } from "react";
import { useParams } from "react-router";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Layers, Loader2, Save, X } from "lucide-react";

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

import SectionLabel from "../../../../../components/SectionLabel";
import { useDiscardGuard } from "../../../../../hooks/useDiscardGuard";
import { decodeHTML } from "../../../../../utils/decode-html";
import { NOT_SAID, SKILL_LEVELS } from "../../../../../utils/venueFacts";
import { FORMAT_LABEL } from "../../../../../utils/tournaments";
import { useCreateDivision, useUpdateDivision } from "../../../../../services/requests/admin/tournaments";

const whole = (min, max, label) =>
  z
    .string()
    .trim()
    .regex(/^\d+$/, `Enter ${label}`)
    .refine((v) => Number(v) >= min && Number(v) <= max, `Between ${min} and ${max}`);

// Mirrors divisionSchema
const schema = z
  .object({
    name: z.string().trim().min(1, "Name the division").max(100),
    teamSize: z.enum(["1", "2"]),
    minLevel: z.string(),
    maxLevel: z.string(),
    capacity: whole(2, 128, "how many teams"),
    entryFee: z
      .string()
      .trim()
      .regex(/^\d+(\.\d{1,2})?$/, "Enter an amount like 500"),
    format: z.enum(["RoundRobin", "SingleElimination", "RoundRobinThenKnockout"]),
    groupSize: z.string(),
    advancePerGroup: z.string(),
    pointsToWin: whole(7, 21, "the points"),
    winBy: z.enum(["1", "2"]),
  })
  .superRefine((v, ctx) => {
    if (v.format === "RoundRobinThenKnockout") {
      if (!/^\d+$/.test(v.groupSize) || Number(v.groupSize) < 3 || Number(v.groupSize) > 8) {
        ctx.addIssue({ code: "custom", path: ["groupSize"], message: "3 to 8 teams per group" });
      }
      if (!/^\d+$/.test(v.advancePerGroup) || Number(v.advancePerGroup) < 1 || Number(v.advancePerGroup) > 4) {
        ctx.addIssue({ code: "custom", path: ["advancePerGroup"], message: "1 to 4 per group" });
      }
    }
    if (v.minLevel !== NOT_SAID && v.maxLevel !== NOT_SAID && SKILL_LEVELS.indexOf(v.minLevel) > SKILL_LEVELS.indexOf(v.maxLevel)) {
      ctx.addIssue({ code: "custom", path: ["maxLevel"], message: "The highest level can't be below the lowest" });
    }
  });

const EMPTY = {
  name: "",
  teamSize: "2",
  minLevel: NOT_SAID,
  maxLevel: NOT_SAID,
  capacity: "16",
  entryFee: "0",
  format: "RoundRobinThenKnockout",
  groupSize: "4",
  advancePerGroup: "2",
  pointsToWin: "11",
  winBy: "2",
};

const fromDivision = (d) => ({
  name: decodeHTML(d.name),
  teamSize: String(d.teamSize),
  minLevel: d.minLevel || NOT_SAID,
  maxLevel: d.maxLevel || NOT_SAID,
  capacity: String(d.capacity),
  entryFee: String(d.entryFee),
  format: d.format,
  groupSize: d.groupSize ? String(d.groupSize) : "4",
  advancePerGroup: d.advancePerGroup ? String(d.advancePerGroup) : "2",
  pointsToWin: String(d.pointsToWin),
  winBy: String(d.winBy),
});

const SelectField = ({ control, name, label, options }) => (
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
            {options.map(([value, text]) => (
              <SelectItem key={value} value={value}>
                {text}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FormMessage />
      </FormItem>
    )}
  />
);

const TextField = ({ control, name, label, hint, ...props }) => (
  <FormField
    control={control}
    name={name}
    render={({ field }) => (
      <FormItem>
        <FormLabel>{label}</FormLabel>
        <FormControl>
          <Input className="h-10" {...props} {...field} />
        </FormControl>
        {hint && <FormDescription>{hint}</FormDescription>}
        <FormMessage />
      </FormItem>
    )}
  />
);

const LEVELS = [[NOT_SAID, "Any"], ...SKILL_LEVELS.map((l) => [l, l])];

/**
 * PLAN-009 phase E — add or change a division (before its draw). `entity`: a
 * division from the tournament page (edit) or null. The tournament comes from the URL.
 */
const DivisionFormDrawer = ({ open, onClose, onSuccess, entity = null }) => {
  const { tournamentId } = useParams();
  const isEditMode = !!entity?.divisionId;
  const createMutation = useCreateDivision();
  const updateMutation = useUpdateDivision();
  const isPending = createMutation.isPending || updateMutation.isPending;
  const form = useForm({ resolver: zodResolver(schema), defaultValues: EMPTY });
  const {
    formState: { isDirty, isSubmitSuccessful },
  } = form;
  const format = useWatch({ control: form.control, name: "format" });

  useEffect(() => {
    if (open) form.reset(isEditMode ? fromDivision(entity) : EMPTY);
  }, [open, isEditMode, entity, form]);

  const handleClose = () => {
    form.reset(EMPTY);
    onClose();
  };
  const { guardedClose, markSaved } = useDiscardGuard({ open, isDirty, isSubmitSuccessful, noun: "division", onClose: handleClose, label: "DivisionFormDrawer" });

  const onSubmit = async (v) => {
    const data = {
      name: v.name,
      teamSize: Number(v.teamSize),
      minLevel: v.minLevel === NOT_SAID ? "" : v.minLevel,
      maxLevel: v.maxLevel === NOT_SAID ? "" : v.maxLevel,
      capacity: Number(v.capacity),
      entryFee: Number(v.entryFee),
      format: v.format,
      groupSize: v.format === "RoundRobinThenKnockout" ? Number(v.groupSize) : "",
      advancePerGroup: v.format === "RoundRobinThenKnockout" ? Number(v.advancePerGroup) : "",
      pointsToWin: Number(v.pointsToWin),
      winBy: Number(v.winBy),
    };
    try {
      if (isEditMode) await updateMutation.mutateAsync({ divisionId: entity.divisionId, data });
      else await createMutation.mutateAsync({ tournamentId, data });
      markSaved();
      onSuccess?.();
    } catch (error) {
      console.error("Form submission error:", error);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(next) => !next && guardedClose()}>
      <SheetContent side="right" showCloseButton={false} className="w-full gap-0 p-0 sm:max-w-200" style={{ background: "var(--color-surface)" }}>
        <SheetTitle className="sr-only">{isEditMode ? "Edit division" : "New division"}</SheetTitle>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} autoComplete="off" className="flex h-full flex-col">
            <div className="flex-1 overflow-y-auto p-6">
              <div className="flex items-start justify-between gap-3 mb-7">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="inline-flex items-center justify-center w-11 h-11 rounded-xl shrink-0 bg-(image:--gradient-primary)">
                    <Layers className="w-5.5 h-5.5 text-white" />
                  </span>
                  <h2 className="m-0 font-semibold leading-tight" style={{ fontSize: 19, color: "var(--color-text-dark)" }}>
                    {isEditMode ? "Edit division" : "New division"}
                  </h2>
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
                  <SectionLabel>Who plays</SectionLabel>
                  <TextField control={form.control} name="name" label="Name" placeholder="e.g., Mixed Doubles 3.5" maxLength={100} />
                  <div className="grid gap-5 sm:grid-cols-2">
                    <SelectField control={form.control} name="teamSize" label="Teams of" options={[["2", "2 (doubles)"], ["1", "1 (singles)"]]} />
                    <TextField control={form.control} name="capacity" label="Most teams" inputMode="numeric" />
                    <SelectField control={form.control} name="minLevel" label="Lowest level" options={LEVELS} />
                    <SelectField control={form.control} name="maxLevel" label="Highest level" options={LEVELS} />
                    <TextField control={form.control} name="entryFee" label="Entry fee per team (₱)" inputMode="decimal" hint="0 = free. The captain pays online." />
                  </div>
                </section>
                <section className="space-y-5">
                  <SectionLabel>Format</SectionLabel>
                  <SelectField control={form.control} name="format" label="Draw" options={Object.entries(FORMAT_LABEL)} />
                  {format === "RoundRobinThenKnockout" && (
                    <div className="grid gap-5 sm:grid-cols-2">
                      <TextField control={form.control} name="groupSize" label="Teams per group" inputMode="numeric" />
                      <TextField control={form.control} name="advancePerGroup" label="Go through per group" inputMode="numeric" />
                    </div>
                  )}
                  <div className="grid gap-5 sm:grid-cols-2">
                    <TextField control={form.control} name="pointsToWin" label="Games to" inputMode="numeric" />
                    <SelectField control={form.control} name="winBy" label="Win by" options={[["2", "2"], ["1", "1"]]} />
                  </div>
                </section>
              </div>
            </div>
            <div className="flex justify-end gap-3 p-6 pt-5" style={{ borderTop: "1px solid var(--color-line)", paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}>
              <Button type="button" variant="outline" size="lg" onClick={guardedClose}>
                Cancel
              </Button>
              <Button type="submit" size="lg" disabled={isPending || (isEditMode && !isDirty)}>
                {isPending ? <Loader2 className="animate-spin" /> : <Save />}
                {isEditMode ? "Save division" : "Add division"}
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
};

export default DivisionFormDrawer;
