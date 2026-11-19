import { Linking } from "react-native";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { shortLink } from "@/utils/dynaCam";

/**
 * A link shown under a QR ("dynacam.ph/session/Ab3…") that also opens when
 * tapped — in the device's browser, for staff checking the game's page.
 * Shows the short form; opens the full link. Never logs it (it's a share link).
 *
 *   <LinkText url={s.shareUrl} className="mt-3 text-[14px]" />
 */
const LinkText = ({ url, className, numberOfLines = 2 }) => {
  const open = async () => {
    try {
      await Linking.openURL(url);
    } catch {
      // No browser on the device — nothing useful to show; the QR still works
    }
  };
  if (!url) return null;
  return (
    <Text
      onPress={open}
      accessibilityRole="link"
      accessibilityHint="Opens the game's page in the browser"
      numberOfLines={numberOfLines}
      suppressHighlighting={false}
      className={cn("text-link text-center font-mono underline", className)}
    >
      {shortLink(url)}
    </Text>
  );
};

export default LinkText;
