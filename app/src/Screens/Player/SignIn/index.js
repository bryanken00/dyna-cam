import { FlaskConical, Info } from "lucide-react-native";
import { ScrollView, View } from "react-native";
import DotsLoader from "@/components/Loading/DotsLoader";
import LogoMark from "@/components/LogoMark";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { IS_DEMO } from "@/constants";
import { useThemeColors } from "@/hooks/useTheme";
import { useSignInScreen } from "./useSignInScreen";

/**
 * PLAN-009 player sign-in — Google only, as on the web (PLAN-006). The in-app
 * browser opens Google and comes back to the app; a first sign-in then asks
 * for the profile.
 *
 * Same shape as the Pair screen: a centred card with the navy brand panel.
 */
const SignInScreen = () => {
  const colors = useThemeColors();
  const m = useSignInScreen();

  return (
    <View className="bg-background flex-1">
      <ScrollView
        contentContainerClassName="grow items-center justify-center p-6"
        showsVerticalScrollIndicator={false}
      >
        <View className="border-border bg-card w-full max-w-[440px] overflow-hidden rounded-3xl border">
          <View className="bg-brand items-center px-5 pb-7 pt-8 sm:px-7">
            <LogoMark />
            <Text className="mt-[18px] font-sans-semibold text-[11.5px] uppercase tracking-[1.6px] text-brand-ball">
              DGSports
            </Text>
            <Text className="font-sans-bold mt-1.5 text-[26px] tracking-tight text-white">
              Sign in
            </Text>
            <Text className="mt-1.5 text-center text-sm text-white/75">
              Book courts, join open plays and keep your games.
            </Text>
            {IS_DEMO ? (
              <View className="mt-3.5 flex-row items-center gap-1.5 rounded-full bg-[#FFF3E0] px-3 py-1.5">
                <FlaskConical size={13} color="#E65100" strokeWidth={2.2} />
                <Text className="font-sans-bold text-[11.5px] text-[#E65100]">
                  Demo mode · signs in without Google
                </Text>
              </View>
            ) : null}
          </View>

          <View className="p-5 sm:p-7">
            {m.notice ? (
              <View className="border-border bg-secondary mb-5 flex-row items-start gap-3 rounded-xl border p-3.5">
                <Info size={18} color={colors.foreground} />
                <Text className="flex-1 text-[13.5px]">{m.notice}</Text>
              </View>
            ) : null}

            <Button
              onPress={m.submit}
              disabled={m.signingIn}
              className="h-[54px] flex-row gap-2"
              accessibilityState={{ busy: m.signingIn }}
            >
              {m.signingIn ? (
                <>
                  <Text className="text-primary-foreground font-sans-bold text-[15.5px]">
                    Signing in
                  </Text>
                  <DotsLoader color={colors.primaryForeground} />
                </>
              ) : (
                <Text className="text-primary-foreground font-sans-bold text-[15.5px]">
                  Continue with Google
                </Text>
              )}
            </Button>

            <View className="mt-3 min-h-[36px] items-center justify-center">
              {m.error ? (
                <Text className="text-destructive text-center text-[13px]" accessibilityRole="alert">
                  {m.error}
                </Text>
              ) : (
                <Text className="text-muted-foreground text-center text-[12px]">
                  We use your Google name, email and photo for your DGSports profile.
                </Text>
              )}
            </View>

            <View className="border-border mt-4 border-t pt-4">
              <Button variant="ghost" onPress={m.changeMode} className="h-11">
                <Text className="text-muted-foreground font-sans-medium text-[14px]">
                  Setting up a courtside device instead?
                </Text>
              </Button>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
};

export default SignInScreen;
