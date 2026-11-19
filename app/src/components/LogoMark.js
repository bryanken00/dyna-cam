import { View } from "react-native";
import Svg, { Line, Rect } from "react-native-svg";
import { useThemeColors } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

/**
 * The Dyna Cam mark (CR-012, the website's `CourtMark`): a pickleball court
 * from above — white lines, a lime kitchen, the net across the middle — on a
 * navy tile with a hairline edge, so it reads on the navy Pair panel and on a
 * light or dark card alike.
 *
 * Uses `useThemeColors` because react-native-svg fills take colour strings.
 * White court lines are the sanctioned `#fff` on a known brand surface.
 *
 *   <LogoMark />
 *   <LogoMark size={48} />
 */
const LogoMark = ({ size = 64, className }) => {
  const colors = useThemeColors();
  const radius = size * 0.28;
  // The court is 24 × 16 units, drawn at 62% of the tile's width
  const courtWidth = size * 0.62;
  const courtHeight = (courtWidth * 16) / 24;

  return (
    <View
      className={cn("items-center justify-center", className)}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: colors.brand,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.14)",
      }}
    >
      <Svg width={courtWidth} height={courtHeight} viewBox="0 0 24 16">
        <Rect x={8.5} y={1.8} width={7} height={12.4} fill={colors.brandBall} />
        <Rect
          x={1}
          y={1}
          width={22}
          height={14}
          rx={2}
          fill="none"
          stroke="#fff"
          strokeWidth={1.6}
        />
        <Line x1={12} y1={0} x2={12} y2={16} stroke="#fff" strokeWidth={1.6} />
      </Svg>
    </View>
  );
};

export default LogoMark;
