import { useEffect, useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Loader2, Phone, Plus, User, X } from "lucide-react";

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
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

import SearchableSelect from "../../../../../components/SearchableSelect";
import SectionLabel from "../../../../../components/SectionLabel";
import { useDiscardGuard } from "../../../../../hooks/useDiscardGuard";
import { decodeHTML } from "../../../../../utils/decode-html";
import {
  PHONE_MAX_LENGTH,
  PHONE_PLACEHOLDER,
  formatPhoneOnChange,
  zPhone,
} from "../../../../../utils/phoneFormat";
import { useGetClipOptions } from "../../../../../services/requests/admin/clips";
import { useCreateSession } from "../../../../../services/requests/admin/sessions";

// CR-005: a game is just a court (+ optional player). No times: pairing the
// court's device starts the recording, End game stops it.
const gameSchema = z.object({
  courtId: z.string().min(1, "Choose the court to record"),
  playerName: z.string().trim().max(100, "Keep the name under 100 characters"),
  phone: zPhone,
});

const emptyValues = () => ({ courtId: "", playerName: "", phone: "" });

const iconPrefix =
  "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2";
const mutedIcon = { color: "var(--color-text-muted)" };

/**
 * New game (CR-005): a court and, optionally, the player. The game waits for
 * the court's session device — pairing it starts the recording, and End game
 * on the device (or End here) stops it. Create only. On success `onSuccess`
 * receives `{ sessionId, shareUrl, courtName, venueName, playerName }` so the
 * page can go straight on to pairing the device.
 */
const SessionFormDrawer = ({ open, onClose, onSuccess }) => {
  const req = <span style={{ color: "var(--color-error)" }}>*</span>;

  const form = useForm({
    resolver: zodResolver(gameSchema),
    defaultValues: emptyValues(),
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
        playerName: values.playerName || null,
        phone: values.phone || null,
      });
      markSaved();
      onSuccess?.({
        sessionId: response?.data?.sessionId,
        shareUrl: response?.data?.shareUrl,
        courtName: decodeHTML(court?.name),
        venueName: decodeHTML(court?.venueName),
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
                      Pair the court&apos;s device next — recording starts when
                      it pairs and stops with End game
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
