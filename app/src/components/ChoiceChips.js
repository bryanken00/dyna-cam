import { Pressable, ScrollView, View } from "react-native";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

/**
 * A single-choice row of pills — filters (venue, court, status) and short
 * pickers (session length, day). Scrolls sideways when it doesn't fit, so
 * it works at 320px with any number of options.
 *
 *   <ChoiceChips
 *     value={venueId}
 *     onChange={setVenueId}
 *     options={[{ value: null, label: "All venues" }, …venues]}
 *   />
 *
 * The selected pill is the inverted primary (like the active page number in
 * ListFooter) — a selection, not an action, so it is not green.
 *
 * @param {Array<{ value: any, label: string, disabled?: boolean }>} options
 * @param {boolean} wrap - wrap onto several lines instead of scrolling
 */
const ChoiceChips = ({ options, value, onChange, wrap = false, className }) => {
  const chips = options.map((opt) => {
    const selected = opt.value === value;
    return (
      <Pressable
        key={String(opt.value)}
        onPress={() => onChange?.(opt.value)}
        disabled={opt.disabled}
        accessibilityRole="radio"
        accessibilityState={{ selected, disabled: Boolean(opt.disabled) }}
        hitSlop={4}
        className={cn(
          "h-9 items-center justify-center rounded-full border px-3.5",
          selected
            ? "bg-primary border-primary"
            : "border-border bg-card active:bg-secondary",
          opt.disabled && "opacity-40",
        )}
      >
        <Text
          className={cn(
            "text-[13px]",
            selected
              ? "text-primary-foreground font-sans-medium"
              : "text-foreground",
          )}
          numberOfLines={1}
        >
          {opt.label}
        </Text>
      </Pressable>
    );
  });

  if (wrap) {
    return (
      <View className={cn("flex-row flex-wrap gap-2", className)}>{chips}</View>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerClassName={cn("gap-2", className)}
    >
      {chips}
    </ScrollView>
  );
};

export default ChoiceChips;
