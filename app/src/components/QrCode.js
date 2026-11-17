import { useMemo } from "react";
import { View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { toQR } from "toqr";
import { cn } from "@/lib/utils";

/** toqr's error-correction levels (its ECLevel enum is type-only). */
const EC_MEDIUM = 0; // ~15% recovery — survives glare on a phone screen

/** Light modules around the code; scanners need at least 4. */
const QUIET_ZONE = 4;

/**
 * A QR code drawn with react-native-svg — for showing a link to a player so
 * they can scan it off the device.
 *
 *   <QrCode value={shareUrl} size={220} />
 *
 * Always black on white, in both themes, on purpose: scanners expect dark
 * modules on a light ground, and an inverted (dark-mode) code fails on many
 * phones. This is the sanctioned `#fff`/`#000` exception in
 * design-guidelines.md §1 — the white tile is its own known surface.
 *
 * The matrix comes from `toqr` (pure JS, zero dependencies): it returns a
 * size×size Uint8Array of 0/1 modules. All dark modules are drawn as ONE
 * path, so a 60×60 code is a single native view, not 3,600.
 */
const QrCode = ({ value, size = 220, className }) => {
  const { path, count } = useMemo(() => {
    if (!value) return { path: "", count: 0 };
    const modules = toQR(String(value), EC_MEDIUM);
    const n = Math.round(Math.sqrt(modules.length));
    let d = "";
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (modules[y * n + x]) {
          d += `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`;
        }
      }
    }
    return { path: d, count: n + QUIET_ZONE * 2 };
  }, [value]);

  if (!count) return null;

  return (
    <View
      className={cn("border-border self-center overflow-hidden rounded-xl border", className)}
      accessible
      accessibilityRole="image"
      accessibilityLabel="QR code of the link"
    >
      <Svg width={size} height={size} viewBox={`0 0 ${count} ${count}`}>
        <Rect x={0} y={0} width={count} height={count} fill="#fff" />
        <Path d={path} fill="#000" />
      </Svg>
    </View>
  );
};

export default QrCode;
