import { useKeepAwake } from "expo-keep-awake";
import { AlertTriangle, CheckCircle2 } from "lucide-react-native";
import { ScrollView, useWindowDimensions, View } from "react-native";
import ConnectionBanner from "@/components/ConnectionBanner";
import DotsLoader from "@/components/Loading/DotsLoader";
import QrCode from "@/components/QrCode";
import TickingTimer from "@/components/TickingTimer";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useThemeColors } from "@/hooks/useTheme";
import { shortLink } from "@/utils/dynaCam";
import { useEndedScreen } from "./useEndedScreen";

/** Wide enough to put the QR beside the text (landscape tablet / phone). */
const SIDE_BY_SIDE_MIN_WIDTH = 640;

/**
 * CR-006: "Saving your game…" while the recorder box makes the game's file,
 * then "Saving your game… uploading 45%" — never "parts".
 */
const savingText = (session) =>
  session.uploadPercent == null
    ? "Saving your game…"
    : `Saving your game… uploading ${session.uploadPercent}%`;

/** The saving progress → "Ready — scan to download", or why not. */
const SavingLine = ({ session }) => {
  const colors = useThemeColors();
  if (!session) return null;
  switch (session.status) {
    case "Ready":
      return (
        <View className="items-center gap-1">
          <View className="flex-row items-center gap-2">
            <CheckCircle2 size={24} color={colors.foreground} />
            <Text className="font-sans-semibold text-[22px]">Ready — scan to download</Text>
          </View>
          {/* Ready can still mean some minutes weren't recorded — the API says which */}
          {session.failureReason ? (
            <Text className="text-muted-foreground text-center text-[13px]">
              {session.failureReason}
            </Text>
          ) : null}
        </View>
      );
    case "Failed":
    case "Cancelled":
      return (
        <View className="flex-row items-center gap-2">
          <AlertTriangle size={22} color={colors.destructive} />
          <Text className="text-destructive shrink text-center font-sans-semibold text-[18px]">
            {session.status === "Cancelled"
              ? "This session was cancelled"
              : session.failureReason
                ? `The game couldn't be saved — ${session.failureReason}`
                : "The game couldn't be saved"}
          </Text>
        </View>
      );
    default:
      // Processing (and the moment right after Stop)
      return (
        <View className="flex-row items-center gap-2">
          <Text className="font-sans-semibold shrink text-center text-[20px]">
            {savingText(session)}
          </Text>
          <DotsLoader color={colors.foreground} size={20} />
        </View>
      );
  }
};

/**
 * After the session ends (Stop, its end time, or staff on the web): the
 * game's QR, full screen, so players can still scan it on their way out —
 * with the saving progress, Done, and "This device unpairs in 9:41".
 *
 * The link works before every part is ready; the page fills in as they are.
 * The screen stays awake until the device unpairs.
 */
const EndedScreen = () => {
  useKeepAwake();
  const colors = useThemeColors();
  const { width, height } = useWindowDimensions();
  const m = useEndedScreen();
  const s = m.session;

  const sideBySide = width > height && width >= SIDE_BY_SIDE_MIN_WIDTH;
  const qrSize = sideBySide
    ? Math.min(height - 120, width * 0.45, 460)
    : Math.min(width - 48, height * 0.5, 460);

  const info = (
    <View className="w-full max-w-[480px] items-center gap-4">
      <SavingLine session={s} />

      <Button
        onPress={m.done}
        disabled={m.leaving}
        className="h-14 w-full"
        accessibilityState={{ busy: m.leaving }}
      >
        <Text className="font-sans-bold text-[17px]">
          {m.leaving ? "Unpairing…" : "Done"}
        </Text>
      </Button>

      {m.unpairInSeconds != null ? (
        <View className="flex-row items-center gap-1.5">
          <Text className="text-muted-foreground text-[14px]">This device unpairs in</Text>
          <TickingTimer
            direction="down"
            seconds={m.unpairInSeconds}
            since={m.since}
            onLimit={m.graceOver}
            accessibilityLabel="This device unpairs in"
            className="text-muted-foreground text-[14px]"
          />
        </View>
      ) : null}
    </View>
  );

  return (
    <View className="bg-background flex-1">
      <ScrollView
        contentContainerClassName="grow items-center justify-center gap-5 p-5"
        showsVerticalScrollIndicator={false}
      >
        <ConnectionBanner error={m.error} className="w-full max-w-[480px]" />

        {s ? (
          <Text className="text-muted-foreground text-center text-[15px]">
            {[s.courtName, s.venueName].filter(Boolean).join(" · ")}
          </Text>
        ) : null}

        {s?.shareUrl ? (
          sideBySide ? (
            <View className="flex-row items-center gap-8">
              <View className="items-center">
                <QrCode value={s.shareUrl} size={qrSize} />
                <Text className="mt-3 font-mono text-[14px]" selectable>
                  {shortLink(s.shareUrl)}
                </Text>
              </View>
              <View className="min-w-0 flex-1 items-center">{info}</View>
            </View>
          ) : (
            <>
              <QrCode value={s.shareUrl} size={qrSize} />
              <Text className="text-center font-mono text-[14px]" numberOfLines={2} selectable>
                {shortLink(s.shareUrl)}
              </Text>
              {info}
            </>
          )
        ) : (
          <DotsLoader color={colors.mutedForeground} />
        )}
      </ScrollView>
    </View>
  );
};

export default EndedScreen;
