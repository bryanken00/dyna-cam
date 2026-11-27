import { useEffect, useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Loader2, Save, Users, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

import StatusToggle from "../../../../../components/StatusToggle";
import { useDiscardGuard } from "../../../../../hooks/useDiscardGuard";
import { decodeHTML } from "../../../../../utils/decode-html";
import { useCreateClub, useGetClubOptions, useUpdateClub } from "../../../../../services/requests/admin/clubs";

// Mirrors createClubSchema / updateClubSchema
const schema = z.object({
  venueId: z.string().min(1, "Pick a venue"),
  name: z.string().trim().min(1, "Name the club").max(100),
  description: z.string().trim().max(1000),
  joinPolicy: z.enum(["Open", "Approval"]),
  status: z.enum(["Active", "Inactive"]),
});
const EMPTY = { venueId: "", name: "", description: "", joinPolicy: "Open", status: "Active" };
const req = <span style={{ color: "var(--color-error)" }}>*</span>;

/** PLAN-009 phase F — add a club, or change one. `entity`: a club row (edit) or null. */
const ClubFormDrawer = ({ open, onClose, onSuccess, entity = null }) => {
  const isEditMode = !!entity?.clubId;
  const { data: optionsData } = useGetClubOptions();
  const venues = useMemo(() => optionsData?.data?.venues || [], [optionsData]);
  const createMutation = useCreateClub();
  const updateMutation = useUpdateClub();
  const isPending = createMutation.isPending || updateMutation.isPending;
  const form = useForm({ resolver: zodResolver(schema), defaultValues: EMPTY });
  const {
    formState: { isDirty, isSubmitSuccessful },
  } = form;

  useEffect(() => {
    if (!open) return;
    form.reset(
      isEditMode
        ? {
            venueId: entity.venueId,
            name: decodeHTML(entity.name),
            description: decodeHTML(entity.description || ""),
            joinPolicy: entity.joinPolicy,
            status: entity.status === "Inactive" ? "Inactive" : "Active",
          }
        : { ...EMPTY, venueId: venues.length === 1 ? venues[0].venueId : "" },
    );
  }, [open, isEditMode, entity, venues, form]);

  const handleClose = () => {
    form.reset(EMPTY);
    onClose();
  };
  const { guardedClose, markSaved } = useDiscardGuard({ open, isDirty, isSubmitSuccessful, noun: "club", onClose: handleClose, label: "ClubFormDrawer" });

  const onSubmit = async (v) => {
    try {
      if (isEditMode) {
        await updateMutation.mutateAsync({
          clubId: entity.clubId,
          body: { name: v.name, description: v.description, joinPolicy: v.joinPolicy, status: v.status },
        });
      } else {
        await createMutation.mutateAsync({ venueId: v.venueId, name: v.name, description: v.description, joinPolicy: v.joinPolicy });
      }
      markSaved();
      onSuccess?.();
    } catch (error) {
      console.error("Form submission error:", error);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(next) => !next && guardedClose()}>
      <SheetContent side="right" showCloseButton={false} className="w-full gap-0 p-0 sm:max-w-160" style={{ background: "var(--color-surface)" }}>
        <SheetTitle className="sr-only">{isEditMode ? "Edit club" : "New club"}</SheetTitle>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} autoComplete="off" className="flex h-full flex-col">
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center justify-center w-11 h-11 rounded-xl shrink-0 bg-(image:--gradient-primary)">
                    <Users className="w-5.5 h-5.5 text-white" />
                  </span>
                  <h2 className="m-0 font-semibold" style={{ fontSize: 19, color: "var(--color-text-dark)" }}>
                    {isEditMode ? "Edit club" : "New club"}
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
              <FormField
                control={form.control}
                name="venueId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Venue {req}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange} disabled={isEditMode}>
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
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name {req}</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Dink Society" className="h-10" maxLength={100} {...field} />
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
                      About it <span style={{ color: "var(--color-text-muted)" }}>(optional)</span>
                    </FormLabel>
                    <FormControl>
                      <Textarea rows={3} maxLength={1000} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="joinPolicy"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Joining</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="h-10 w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Open">Anyone can join</SelectItem>
                        <SelectItem value="Approval">Staff approve each player</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>Members-only Open Play sessions take this club's members only.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {isEditMode && (
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <StatusToggle value={field.value} onChange={field.onChange} />
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>
            <div className="flex justify-end gap-3 p-6 pt-5" style={{ borderTop: "1px solid var(--color-line)", paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}>
              <Button type="button" variant="outline" size="lg" onClick={guardedClose}>
                Cancel
              </Button>
              <Button type="submit" size="lg" disabled={isPending || (isEditMode && !isDirty)}>
                {isPending ? <Loader2 className="animate-spin" /> : <Save />}
                {isEditMode ? "Save club" : "Add club"}
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
};

export default ClubFormDrawer;
