import { FlaskConical, Info, Link2 } from "lucide-react-native";
import { KeyboardAvoidingView, ScrollView, View } from "react-native";
import DotsLoader from "@/components/Loading/DotsLoader";
import LogoMark from "@/components/LogoMark";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { IS_DEMO } from "@/constants";
import { useThemeColors } from "@/hooks/useTheme";
import PairKeyInput from "./PairKeyInput";
import { KEY_LENGTH, usePairScreen } from "./usePairScreen";

/**
 * "Pair this device" — the screen whenever the device isn't paired
 * (PLAN-002 Phase E). Staff book a session on the web and tap "Pair a
 * device", which shows a 6-digit key; typing it here pairs this device to
 * that one session. It shows the session until it ends, then unpairs itself
 * and comes back here — with a notice saying why.
 *
 * There is no sign-in: staff work happens on the web.
 *
 * Centred card, LogoMark, max-w-[440px], keyboard avoidance. App.js
 * provides the safe area and the status bar.
 */
const PairScreen = () => {
  const colors = useThemeColors();
  const m = usePairScreen();

  return (
    <View className="bg-background flex-1">
      <KeyboardAvoidingView className="flex-1" behavior="padding">
        <ScrollView
          contentContainerClassName="grow items-center justify-center p-6"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View className="border-border bg-card w-full max-w-[440px] rounded-3xl border p-5 sm:p-7">
            <View className="mb-6 items-center">
              <LogoMark />
              <Text className="font-sans-bold mt-[18px] text-[26px] tracking-tight">
                Pair this device
              </Text>
              <Text className="text-muted-foreground mt-1.5 text-center text-sm">
                Enter the 6-digit key from the session in the Admin portal:{"\n"}
                Sessions → the session → Pair a device.
              </Text>

              {IS_DEMO ? (
                <View className="mt-3.5 flex-row items-center gap-1.5 rounded-full bg-[#FFF3E0] px-3 py-1.5">
                  <FlaskConical size={13} color="#E65100" strokeWidth={2.2} />
                  <Text className="font-sans-bold text-[11.5px] text-[#E65100]">
                    Demo mode · any key works except 000000
                  </Text>
                </View>
              ) : null}
            </View>

            {m.notice ? (
              <View className="border-border bg-secondary mb-5 flex-row items-start gap-3 rounded-xl border p-3.5">
                <Info size={18} color={colors.foreground} />
                <Text className="flex-1 text-[13.5px]">{m.notice}</Text>
              </View>
            ) : null}

            <PairKeyInput
              value={m.code}
              onChange={m.setCode}
              length={KEY_LENGTH}
              error={Boolean(m.error)}
              disabled={m.pairing}
              autoFocus
            />

            <View className="mt-3 min-h-[40px] items-center justify-center">
              {m.error ? (
                <Text
                  className="text-destructive text-center text-[13px]"
                  accessibilityRole="alert"
                >
                  {m.error}
                </Text>
              ) : (
                <Text className="text-muted-foreground text-center text-[12px]">
                  The key works once and expires after 10 minutes.
                </Text>
              )}
            </View>

            <Button
              onPress={m.submit}
              disabled={!m.complete || m.pairing}
              className="mt-2 h-[54px] flex-row gap-2"
              accessibilityState={{ disabled: !m.complete, busy: m.pairing }}
            >
              {m.pairing ? (
                <>
                  <Text className="text-primary-foreground font-sans-bold text-[15.5px]">
                    Pairing
                  </Text>
                  <DotsLoader color={colors.primaryForeground} />
                </>
              ) : (
                <>
                  <Link2 size={18} color={colors.primaryForeground} />
                  <Text className="text-primary-foreground font-sans-bold text-[15.5px]">
                    Pair device
                  </Text>
                </>
              )}
            </Button>
          </View>

        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

export default PairScreen;
