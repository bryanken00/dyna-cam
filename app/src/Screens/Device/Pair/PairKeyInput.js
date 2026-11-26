import { useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

/**
 * Six big digit boxes over ONE real TextInput.
 *
 * The input is laid invisibly over the boxes rather than hidden, so
 * everything a phone does with a text field still works on the boxes: a tap
 * focuses it (number pad), long-press offers Paste, and the keyboard's own
 * paste/autofill suggestions land in it. The parent strips anything that
 * isn't a digit, so a pasted "123-456" or "123 456" becomes 123456 — which is
 * also why there is no `maxLength` here (it would cut the raw text first).
 */
const PairKeyInput = ({ value, onChange, length = 6, error, disabled, autoFocus }) => {
  const inputRef = useRef(null);
  const [focused, setFocused] = useState(false);

  return (
    <Pressable
      onPress={() => inputRef.current?.focus()}
      accessible={false}
      className="relative w-full"
    >
      {/* Boxes share the card's width (flex-1, capped), so six of them fit a
          320px phone and don't sprawl on a tablet */}
      <View className="flex-row justify-center gap-2" pointerEvents="none">
        {Array.from({ length }, (_, i) => {
          const digit = value[i] ?? "";
          const active = focused && i === Math.min(value.length, length - 1);
          return (
            <View
              key={i}
              className={cn(
                "bg-card h-16 max-w-[56px] flex-1 items-center justify-center rounded-xl border-2",
                error
                  ? "border-destructive"
                  : active
                    ? "border-ring"
                    : digit
                      ? "border-primary"
                      : "border-border",
              )}
            >
              <Text className="font-mono text-[26px]">{digit}</Text>
            </View>
          );
        })}
      </View>

      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        editable={!disabled}
        autoFocus={autoFocus}
        keyboardType="number-pad"
        inputMode="numeric"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        caretHidden
        contextMenuHidden={false}
        accessibilityLabel="Pairing key, 6 digits"
        accessibilityHint="Enter or paste the key shown in the Admin portal"
        // Covers the boxes exactly; invisible, but still receives taps and paste
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          opacity: 0,
          fontSize: 1,
        }}
      />
    </Pressable>
  );
};

export default PairKeyInput;
