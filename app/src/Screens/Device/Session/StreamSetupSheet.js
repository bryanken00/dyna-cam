import { Radio, RefreshCw } from "lucide-react-native";
import { useWindowDimensions, View } from "react-native";
import DotsLoader from "@/components/Loading/DotsLoader";
import QrCode from "@/components/QrCode";
import TickingTimer from "@/components/TickingTimer";
import { FormSheet } from "@/components/pattern";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useThemeColors } from "@/hooks/useTheme";
import { shortLink } from "@/utils/dynaCam";

/**
 * "Stream to your Facebook / YouTube" (PLAN-002 Phase G): a QR the PLAYER
 * scans with their own phone. It opens a Dyna Cam page where they pick the
 * platform and paste their stream key — the key never touches this shared
 * device. The sheet closes by itself once the stream shows up on the session.
 *
 * State comes from `useStreamSetup` (the `s` prop): the link, its countdown,
 * "New code" after it expires, and errors (the session ended — 409 — or no
 * connection).
 */
const StreamSetupSheet = ({ s }) => {
  const colors = useThemeColors();
  const { width, height } = useWindowDimensions();
  const qrSize = Math.max(200, Math.min(width - 80, height * 0.45, 360));

  return (
    <FormSheet
      open={s.open}
      onClose={s.close}
      icon={Radio}
      title="Stream to your Facebook / YouTube"
      subtitle="Set up on the player's own phone"
      footer={
        <Button variant="outline" onPress={s.close} className="h-12 flex-1">
          <Text>Close</Text>
        </Button>
      }
    >
      <View className="w-full max-w-[480px] items-center gap-4 self-center pt-2">
        {s.loading ? (
          <View className="items-center py-16">
            <DotsLoader color={colors.mutedForeground} />
          </View>
        ) : s.error ? (
          <View className="items-center gap-4 py-10">
            <Text className="text-destructive text-center text-[14px]">{s.error}</Text>
            <Button variant="outline" onPress={s.newCode} className="h-12 flex-row gap-2 px-6">
              <RefreshCw size={16} color={colors.foreground} />
              <Text>Try again</Text>
            </Button>
          </View>
        ) : s.expired ? (
          <View className="items-center gap-4 py-10">
            <Text className="text-center font-sans-semibold text-[17px]">
              This code has expired
            </Text>
            <Button onPress={s.newCode} className="h-12 flex-row gap-2 px-6">
              <RefreshCw size={16} color={colors.primaryForeground} />
              <Text>New code</Text>
            </Button>
          </View>
        ) : s.link?.url ? (
          <>
            <Text className="text-center font-sans-semibold text-[17px]">
              Scan with your phone and paste your stream key
            </Text>
            <QrCode value={s.link.url} size={qrSize} />
            <Text className="text-center font-mono text-[13px]" numberOfLines={2} selectable>
              {shortLink(s.link.url)}
            </Text>
            <View className="flex-row items-center gap-1.5">
              <Text className="text-muted-foreground text-[13px]">Code expires in</Text>
              <TickingTimer
                direction="down"
                seconds={s.link.expiresInSeconds}
                since={s.link.receivedAt}
                onLimit={s.onExpire}
                accessibilityLabel="Code expires in"
                className="text-muted-foreground text-[13px]"
              />
            </View>
            <Text className="text-muted-foreground text-center text-[12.5px]">
              The key is typed on the player's phone, never on this device. Streaming
              starts with the game and stops when it ends; the recording isn't affected.
            </Text>
          </>
        ) : null}
      </View>
    </FormSheet>
  );
};

export default StreamSetupSheet;
