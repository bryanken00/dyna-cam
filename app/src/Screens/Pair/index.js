import { useNavigation } from "@react-navigation/native";
import { FlaskConical, Info, Link2 } from "lucide-react-native";
import {
  KeyboardAvoidingView,
  ScrollView,
  StatusBar,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import DotsLoader from "@/components/Loading/DotsLoader";
import LogoMark from "@/components/LogoMark";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { IS_DEMO } from "@/constants";
import { SCREEN_NAVIGATION } from "@/constants/navigations";
import { useThemeColors } from "@/hooks/useTheme";
import useThemeStore from "@/store/useThemeStore";
import PairKeyInput from "./PairKeyInput";
import { KEY_LENGTH, usePairScreen } from "./usePairScreen";

/**
 * "Pair this phone" — the first screen on a phone that is neither paired nor
 * signed in (PLAN-002). A manager creates a 6-digit key in the web portal
 * (Dyna Cam → Paired Apps → Pair a phone); typing it here pairs the phone to
 * that venue, and it opens straight to the venue's courts from then on.
 *
 * Managers who want the full app sign in with their staff account instead —
 * the small link at the bottom pushes the existing Login screen.
 *
 * Layout follows Login (the design reference): centred card, LogoMark,
 * max-w-[440px], safe areas, keyboard avoidance.
 */
const PairScreen = () => {
  const navigation = useNavigation();
  const colors = useThemeColors();
  const isDark = useThemeStore((s) => s.isDarkMode);
  const m = usePairScreen();

  return (
    <SafeAreaView className="bg-background flex-1" edges={["top", "bottom"]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

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
                Pair this phone
              </Text>
              <Text className="text-muted-foreground mt-1.5 text-center text-sm">
                Enter the 6-digit key from the Admin portal:{"\n"}
                Dyna Cam → Paired Apps → Pair a phone.
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
                    Pair phone
                  </Text>
                </>
              )}
            </Button>
          </View>

          <TouchableOpacity
            onPress={() => navigation.navigate(SCREEN_NAVIGATION.Login)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="link"
            className="mt-6 py-2"
          >
            <Text className="text-muted-foreground text-[13.5px]">
              Sign in with a staff account instead
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

export default PairScreen;
