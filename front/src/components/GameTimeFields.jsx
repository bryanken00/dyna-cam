import { useWatch } from "react-hook-form";
import { Clock } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

import { formatMinutes } from "../utils/dynaCam";
import { fromGameMinutes, toGameMinutes } from "../utils/gameTime";

const iconPrefix =
  "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2";

/**
 * CR-016: a game time as Hours + Minutes inputs (shared by New game and Add
 * time), with optional one-tap presets (in minutes). The zod shape and the
 * minute conversions are in utils/gameTime.js.
 * Props: `{ form, presets?, autoFocus? }` — the form has `hours` and `minutes`.
 */
const GameTimeFields = ({ form, presets = [], autoFocus = false }) => {
  const hours = useWatch({ control: form.control, name: "hours" }) ?? "";
  const minutes = useWatch({ control: form.control, name: "minutes" }) ?? "";
  const total = toGameMinutes({ hours, minutes });

  const pick = (value) => {
    const next = fromGameMinutes(value);
    form.setValue("hours", next.hours, { shouldDirty: true, shouldValidate: true });
    form.setValue("minutes", next.minutes, { shouldDirty: true, shouldValidate: true });
  };

  return (
    <div>
      <div className="grid grid-cols-2 gap-4 items-start sm:max-w-100">
        <FormField
          control={form.control}
          name="hours"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Hours</FormLabel>
              <div className="relative">
                <Clock className={iconPrefix} style={{ color: "var(--color-text-muted)" }} />
                <FormControl>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    placeholder="0"
                    className="h-10 pl-9"
                    autoFocus={autoFocus}
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
          name="minutes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Minutes</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={59}
                  step={1}
                  placeholder="0"
                  className="h-10"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {presets.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {presets.map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant="outline"
              aria-pressed={total === value}
              className={
                total === value ? "border-(--color-ring) bg-(--color-surface-sunken)" : undefined
              }
              onClick={() => pick(value)}
            >
              {formatMinutes(value)}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
};

export default GameTimeFields;
