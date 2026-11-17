import { Cast, Link2, SquarePlay } from "lucide-react";

// lucide has no brand marks, so each platform gets a plain stand-in; the
// label next to it (STREAM_PLATFORM_LABEL) names the platform.
const ICONS = { FACEBOOK: Cast, YOUTUBE: SquarePlay, OTHER: Link2 };

/** The icon for a stream platform ("FACEBOOK" | "YOUTUBE" | "OTHER"). */
const StreamPlatformIcon = ({ platform, className = "w-4 h-4", style }) => {
  const Icon = ICONS[platform] || Cast;
  return <Icon className={className} style={style} aria-hidden="true" />;
};

export default StreamPlatformIcon;
