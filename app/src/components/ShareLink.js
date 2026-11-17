import { QrCode as QrIcon, Share2 } from "lucide-react-native";
import { useState } from "react";
import { Share, View } from "react-native";
import QrCode from "@/components/QrCode";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useThemeColors } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

/**
 * A link a player needs — a clip's or session's share page, a court's QR
 * sign — with the two ways to hand it over from a staff phone: a QR they
 * scan off the screen, and the system share sheet (which also has "Copy" on
 * both platforms, so the app needs no clipboard module).
 *
 *   <ShareLink url={clip.shareUrl} />                    // QR shown
 *   <ShareLink url={court.qrUrl} collapsible />          // "Show QR" toggle
 *
 * @param {boolean} collapsible - start with the QR hidden behind a toggle
 * @param {string}  shareMessage - text sent with the link in the share sheet
 */
const ShareLink = ({
  url,
  collapsible = false,
  shareMessage,
  qrSize = 220,
  className,
}) => {
  const colors = useThemeColors();
  const [showQr, setShowQr] = useState(!collapsible);

  if (!url) return null;

  const share = async () => {
    try {
      await Share.share({
        message: shareMessage ? `${shareMessage}\n${url}` : url,
        url, // iOS shows a link preview from this
      });
    } catch (error) {
      console.error("Share failed:", error);
    }
  };

  return (
    <View className={cn("gap-3", className)}>
      {showQr ? <QrCode value={url} size={qrSize} /> : null}

      <Text
        className="text-muted-foreground text-center font-mono text-[12px]"
        numberOfLines={2}
        selectable
      >
        {url}
      </Text>

      <View className="flex-row gap-3">
        {collapsible ? (
          <Button
            variant="outline"
            onPress={() => setShowQr((v) => !v)}
            className="h-11 flex-1 flex-row gap-2"
          >
            <QrIcon size={16} color={colors.foreground} />
            <Text>{showQr ? "Hide QR" : "Show QR"}</Text>
          </Button>
        ) : null}
        <Button
          variant="outline"
          onPress={share}
          className="h-11 flex-1 flex-row gap-2"
        >
          <Share2 size={16} color={colors.foreground} />
          <Text>Share link</Text>
        </Button>
      </View>
    </View>
  );
};

export default ShareLink;
