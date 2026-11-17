import { Image } from "expo-image";
import { Film } from "lucide-react-native";
import { View } from "react-native";
import { useThemeColors } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import { fileUrl } from "@/utils/dynaCam";

/**
 * A clip's thumbnail, or a film-strip placeholder while the clip isn't Ready
 * (the API only signs a thumbnail for a Ready clip).
 *
 *   <ClipThumb uri={clip.thumbnailUrl} width={72} />          // list row
 *   <ClipThumb uri={clip.thumbnailUrl} className="w-full" />  // detail hero
 *
 * Always 16:9, explicit size (engineering-checklist §3). `uri` is the API's
 * signed relative link, passed through `fileUrl()` untouched.
 */
const ClipThumb = ({ uri, width, className }) => {
  const colors = useThemeColors();
  const src = fileUrl(uri);
  const sizeStyle = width
    ? { width, height: Math.round((width * 9) / 16) }
    : { aspectRatio: 16 / 9 };

  return (
    <View
      className={cn(
        "border-border bg-secondary items-center justify-center overflow-hidden rounded-lg border",
        className,
      )}
      style={sizeStyle}
    >
      {src ? (
        <Image
          source={{ uri: src }}
          style={{ width: "100%", height: "100%" }}
          contentFit="cover"
          transition={150}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <Film
          size={width && width < 100 ? 18 : 30}
          strokeWidth={1.6}
          color={colors.mutedForeground}
        />
      )}
    </View>
  );
};

export default ClipThumb;
