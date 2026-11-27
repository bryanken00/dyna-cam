import { CircleAlert, Loader2, Save, ShieldQuestion } from "lucide-react";

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

import { useSportCardHooks } from "../hooks";
import Spinner from "../../../../components/Spinner";
import { NOT_SAID, SKILL_LEVELS } from "../../../../utils/venueFacts";

const cardStyle = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-line)",
  borderRadius: "var(--radius-card)",
};

const optional = <span style={{ color: "var(--color-text-muted)" }}>(optional)</span>;

/**
 * PLAN-009 phase B: the player's pickleball level and DUPR rating. Open Play
 * and tournaments use the level to balance games; the DUPR rating is the
 * player's own word until DUPR sync exists, so it shows as unverified.
 */
const SportCard = () => {
  const { isLoading, sport, form, handleSave, isSaving, isDirty, saveError } = useSportCardHooks();

  return (
    <div className="p-5" style={cardStyle}>
      <h2 className="m-0 font-semibold" style={{ fontSize: 16, color: "var(--color-text-dark)" }}>
        Pickleball
      </h2>
      <p className="m-0 mt-1 mb-4" style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}>
        Your level helps Open Play and tournaments put you in fair games.
      </p>

      {isLoading ? (
        <Spinner className="py-8" />
      ) : (
        <Form {...form}>
          <form onSubmit={handleSave} noValidate className="space-y-4">
            <FormField
              control={form.control}
              name="skillLevel"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Your level {optional}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="h-11 w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NOT_SAID}>Not set</SelectItem>
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

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="duprId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>DUPR ID {optional}</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., AB12CD" className="h-11 uppercase" maxLength={20} autoCapitalize="characters" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="duprRating"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>DUPR rating {optional}</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., 3.512" className="h-11" inputMode="decimal" maxLength={5} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            {sport?.duprRating !== null && sport?.duprRating !== undefined && !sport.duprVerified && (
              <FormDescription className="flex items-start gap-1.5">
                <ShieldQuestion className="size-4 shrink-0 mt-0.5" />
                Shown as unverified — DUPR hasn&apos;t confirmed it.
              </FormDescription>
            )}

            {saveError && (
              <p role="alert" className="m-0 flex items-start gap-2" style={{ fontSize: 13.5, color: "var(--color-error)" }}>
                <CircleAlert className="size-4 shrink-0 mt-0.5" />
                {saveError}
              </p>
            )}

            <Button type="submit" variant="outline" size="lg" className="w-full h-11" disabled={isSaving || !isDirty}>
              {isSaving ? <Loader2 className="animate-spin" /> : <Save />}
              Save pickleball
            </Button>
          </form>
        </Form>
      )}
    </div>
  );
};

export default SportCard;
