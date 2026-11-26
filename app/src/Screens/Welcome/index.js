import { ChevronRight, Smartphone, Trophy } from "lucide-react-native";
import { Pressable, ScrollView, View } from "react-native";
import LogoMark from "@/components/LogoMark";
import { Text } from "@/components/ui/text";
import { useThemeColors } from "@/hooks/useTheme";
import { APP_MODE, useAppModeStore } from "@/store/useAppModeStore";

/**
 * PLAN-009 first launch: what is this phone for? Remembered on the device;
 * the player's Me tab and the Pair screen can come back here.
 *
 *   I'm a player                → the player app (sign in with Google)
 *   Set up a courtside device   → today's Pair → Session → Ended (PLAN-002)
 */
const ModeOption = ({ Icon, title, message, onPress, primary }) => {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={message}
      className={
        primary
          ? "bg-primary flex-row items-center gap-4 rounded-2xl p-4 active:opacity-90"
          : "border-border bg-card flex-row items-center gap-4 rounded-2xl border p-4 active:bg-secondary"
      }
    >
      <View
        className={
          primary
            ? "h-11 w-11 items-center justify-center rounded-xl bg-white/15"
            : "border-border bg-secondary h-11 w-11 items-center justify-center rounded-xl border"
        }
      >
        <Icon size={21} color={primary ? colors.primaryForeground : colors.foreground} />
      </View>
      <View className="flex-1">
        <Text
          className={
            primary
              ? "text-primary-foreground font-sans-semibold text-[16px]"
              : "font-sans-semibold text-[16px]"
          }
        >
          {title}
        </Text>
        <Text
          className={
            primary
              ? "text-primary-foreground/80 mt-0.5 text-[13px]"
              : "text-muted-foreground mt-0.5 text-[13px]"
          }
        >
          {message}
        </Text>
      </View>
      <ChevronRight size={18} color={primary ? colors.primaryForeground : colors.mutedForeground} />
    </Pressable>
  );
};

const WelcomeScreen = () => {
  const setMode = useAppModeStore((s) => s.setMode);

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
            <Text className="font-sans-bold mt-1.5 text-center text-[26px] tracking-tight text-white">
              Welcome
            </Text>
            <Text className="mt-1.5 text-center text-sm text-white/75">
              Book courts, join open plays and get your games on your phone.
            </Text>
          </View>

          <View className="gap-3 p-5 sm:p-7">
            <ModeOption
              primary
              Icon={Trophy}
              title="I'm a player"
              message="Sign in with Google to book and play."
              onPress={() => setMode(APP_MODE.player)}
            />
            <ModeOption
              Icon={Smartphone}
              title="Set up a courtside device"
              message="For venue staff: show a game's live view and QR at the court."
              onPress={() => setMode(APP_MODE.device)}
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
};

export default WelcomeScreen;
