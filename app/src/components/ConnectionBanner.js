import { WifiOff } from "lucide-react-native";
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { useThemeColors } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import { isConnectionError } from "@/utils/dynaCam";

/**
 * "Can't reach Dyna Cam — retrying" — shown on the Session and Ended screens
 * while the session poll can't reach the API (no response or 5xx). It
 * renders nothing for any other error, and nothing at all once the next poll
 * succeeds; the poll keeps going on its own (services/requests/session.js).
 *
 *   <ConnectionBanner error={courts.error} />
 *
 * A connection error never unpairs the device — only the API saying so does.
 */
const ConnectionBanner = ({ error, className }) => {
  const colors = useThemeColors();
  if (!isConnectionError(error)) return null;

  return (
    <View
      className={cn(
        "border-destructive bg-destructive/10 flex-row items-center gap-3 rounded-xl border px-4 py-3",
        className,
      )}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <WifiOff size={18} color={colors.destructive} />
      <View className="min-w-0 flex-1">
        <Text className="text-destructive font-sans-semibold text-[14px]">
          Can't reach Dyna Cam — retrying
        </Text>
        <Text className="text-muted-foreground text-[12px]">
          Check the device's Wi-Fi. It stays paired.
        </Text>
      </View>
    </View>
  );
};

export default ConnectionBanner;
