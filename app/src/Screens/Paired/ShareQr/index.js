import { useNavigation } from "@react-navigation/native";
import { useKeepAwake } from "expo-keep-awake";
import { AlertTriangle, CheckCircle2, Share2 } from "lucide-react-native";
import { ScrollView, Share, useWindowDimensions, View } from "react-native";
import ConnectionBanner from "@/components/ConnectionBanner";
import DotsLoader from "@/components/Loading/DotsLoader";
import QrCode from "@/components/QrCode";
import ScreenHeader from "@/components/ScreenHeader";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useThemeColors } from "@/hooks/useTheme";
import { formatPayCode, formatPeso } from "@/utils/dynaCam";
import { useShareQr } from "./useShareQr";

/** "https://dynacam.ph/clip/Ab3…" → "dynacam.ph/clip/Ab3…" — what's worth reading out. */
const shortLink = (url) => String(url ?? "").replace(/^https?:\/\//, "");

/** The status under the QR, in large type: Saving… → Ready (or why not). */
const StatusLine = ({ status }) => {
  const colors = useThemeColors();
  const { tone, text, note } = status;
  return (
    <View className="items-center gap-1">
      <View className="flex-row items-center gap-2">
        {tone === "ready" ? (
          <CheckCircle2 size={22} color={colors.foreground} />
        ) : tone === "failed" ? (
          <AlertTriangle size={20} color={colors.destructive} />
        ) : tone === "recording" ? (
          <View className="bg-destructive h-3 w-3 rounded-full" />
        ) : null}
        <Text
          className={
            tone === "failed"
              ? "text-destructive shrink text-center font-sans-semibold text-[17px]"
              : "shrink text-center font-sans-semibold text-[20px]"
          }
        >
          {text}
        </Text>
        {tone === "saving" ? (
          <DotsLoader color={colors.foreground} size={20} />
        ) : null}
      </View>
      {note ? (
        <Text className="text-muted-foreground text-center text-[13px]">{note}</Text>
      ) : null}
    </View>
  );
};

/**
 * Full-screen QR of a clip's — or a whole game's — share link, for the player
 * to photograph (iOS Photos and Google Lens read QR codes in photos) or scan
 * live. Params `{ kind: "clip" | "session", id, … }` (see useShareQr).
 *
 *  • As large as the screen allows, black on white in both themes (QrCode),
 *    so it reads from about a metre away.
 *  • The screen stays awake while it's up (expo-keep-awake) — the phone is
 *    often held out to the player for a while.
 *  • The short link is written underneath, and Share sends it to a phone.
 *  • A priced clip (a player's own QR/button save) shows what to pay at the
 *    desk and its pay code. A paired phone's own Record is a free STAFF clip.
 *
 * Done goes back to the court.
 */
const ShareQrScreen = () => {
  useKeepAwake();
  const navigation = useNavigation();
  const colors = useThemeColors();
  const { width, height } = useWindowDimensions();
  const m = useShareQr();

  // Biggest square that leaves room for the text and Done on screen
  const qrSize = Math.max(200, Math.min(width - 40, height * 0.52, 480));

  const share = async () => {
    try {
      await Share.share({ message: m.shareUrl, url: m.shareUrl });
    } catch (error) {
      console.error("Share failed:", error?.message);
    }
  };

  return (
    <View className="bg-background flex-1">
      <ScreenHeader
        title={m.courtName ? `${m.courtName} · ${m.noun}` : m.isGame ? "Game" : "Clip"}
        onBack={navigation.goBack}
      />

      <ScrollView
        contentContainerClassName="grow items-center px-5 pb-6 pt-4"
        showsVerticalScrollIndicator={false}
      >
        <ConnectionBanner error={m.error} className="mb-4 w-full max-w-[480px]" />

        {m.notFound ? (
          <Text className="text-muted-foreground mt-10 text-center text-[15px]">
            {`This ${m.noun} is no longer available.`}
          </Text>
        ) : m.shareUrl ? (
          <>
            <Text className="text-muted-foreground mb-3 text-center text-[15px]">
              Take a photo of this code, or scan it
            </Text>

            <QrCode value={m.shareUrl} size={qrSize} />

            <Text
              className="mt-3 text-center font-mono text-[14px]"
              numberOfLines={2}
              selectable
            >
              {shortLink(m.shareUrl)}
            </Text>

            <View className="mt-4 min-h-[32px] items-center">
              <StatusLine status={m.status} />
            </View>

            {m.isGame ? (
              <Text className="text-muted-foreground mt-2 text-center text-[13px]">
                The link works now — the game's parts appear on it as they're saved.
              </Text>
            ) : null}

            {m.merged ? (
              <Text className="text-muted-foreground mt-2 text-center text-[13px]">
                This moment was already being saved — it's the same clip.
              </Text>
            ) : null}

            {m.unpaid ? (
              <View className="border-border bg-card mt-4 w-full max-w-[480px] rounded-xl border px-4 py-3">
                <Text className="text-center text-[15px]">
                  {`Player pays ${formatPeso(m.unpaid.price)} at the desk`}
                </Text>
                <Text className="mt-0.5 text-center font-mono text-[18px]">
                  {`code ${formatPayCode(m.unpaid.payCode)}`}
                </Text>
              </View>
            ) : m.paid ? (
              <Text className="text-muted-foreground mt-3 text-[13px]">Paid</Text>
            ) : null}
          </>
        ) : (
          <View className="items-center py-20">
            <DotsLoader color={colors.mutedForeground} />
          </View>
        )}
      </ScrollView>

      <View className="border-border w-full flex-row gap-3 border-t px-5 pb-4 pt-3">
        <Button
          variant="outline"
          onPress={share}
          disabled={!m.shareUrl}
          className="h-14 flex-1 flex-row gap-2"
        >
          <Share2 size={18} color={colors.foreground} />
          <Text className="text-[16px]">Share link</Text>
        </Button>
        <Button onPress={navigation.goBack} className="h-14 flex-1">
          <Text className="font-sans-semibold text-[16px]">Done</Text>
        </Button>
      </View>
    </View>
  );
};

export default ShareQrScreen;
