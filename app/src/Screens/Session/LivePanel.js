import { useEvent } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { Volume2, VolumeX, Wifi } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import DotsLoader from "@/components/Loading/DotsLoader";
import { Text } from "@/components/ui/text";
import { useThemeColors } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import { useLiveSource } from "./useLiveSource";

/** After a playback error, try the same link again this often. */
const RETRY_MS = 15000;

/**
 * The court's live video, straight from the venue's recorder box over the
 * LAN (HLS, about 5 s behind) — PLAN-002 §5.4.
 *
 * Muted by default (it's a court, not a TV) with an unmute toggle. When there
 * is no link (`live: null`) or playback fails — the device isn't on the
 * venue Wi-Fi, the box is offline — a calm panel says so; recording is never
 * affected by it. After an error it retries every 15 s, and whenever the
 * session poll brings a different link (see useLiveSource).
 *
 * The video surface is black in both themes on purpose (letterboxing), the
 * sanctioned `#000`-on-a-known-surface exception.
 *
 * ⚠️ The link and the player's error can contain the link's `sig` — nothing
 * here logs either.
 */
const LivePanel = ({ live, scheduled, className }) => {
  const colors = useThemeColors();
  const source = useLiveSource(live);
  const [muted, setMuted] = useState(true);

  const player = useVideoPlayer(null, (p) => {
    p.muted = true;
    p.loop = false;
  });
  const { status } = useEvent(player, "statusChange", { status: player.status });

  // Load (or drop) the stream when the stable source changes
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        if (source) {
          // contentType makes iOS treat it as HLS whatever the URL looks like
          await player.replaceAsync({ uri: source.uri, contentType: "hls" });
          if (!cancelled) player.play();
        } else {
          player.pause();
          await player.replaceAsync(null);
        }
      } catch {
        // Shown through `status`; the error can carry the signed link
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [source, player]);

  // After an error, retry the same link every so often
  useEffect(() => {
    if (status !== "error" || !source) return undefined;
    const id = setInterval(() => {
      player
        .replaceAsync({ uri: source.uri, contentType: "hls" })
        .then(() => player.play())
        .catch(() => {});
    }, RETRY_MS);
    return () => clearInterval(id);
  }, [status, source, player]);

  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);

  const playing = Boolean(source) && status !== "error";

  return (
    <View
      className={cn(
        "border-border w-full overflow-hidden rounded-[18px] border bg-black",
        className,
      )}
      style={{ aspectRatio: 16 / 9 }}
    >
      {playing ? (
        <>
          <VideoView
            player={player}
            style={{ width: "100%", height: "100%" }}
            contentFit="contain"
            nativeControls={false}
            allowsPictureInPicture={false}
            accessibilityLabel="Live video of the court"
          />
          {status === "loading" || status === "idle" ? (
            <View className="absolute inset-0 items-center justify-center">
              <DotsLoader color="#fff" />
            </View>
          ) : null}
          <Pressable
            onPress={() => setMuted((m) => !m)}
            accessibilityRole="button"
            accessibilityLabel={muted ? "Turn sound on" : "Turn sound off"}
            hitSlop={8}
            className="absolute bottom-3 right-3 h-11 w-11 items-center justify-center rounded-full bg-black/60"
          >
            {muted ? (
              <VolumeX size={20} color="#fff" />
            ) : (
              <Volume2 size={20} color="#fff" />
            )}
          </Pressable>
          <View className="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1">
            <Text className="font-sans-semibold text-[11px] uppercase tracking-[0.08em] text-white">
              Live
            </Text>
          </View>
        </>
      ) : (
        <View className="bg-card flex-1 items-center justify-center gap-2 px-6">
          <Wifi size={26} color={colors.mutedForeground} strokeWidth={1.8} />
          <Text className="text-center font-sans-medium text-[15px]">
            {scheduled
              ? "Live view starts when recording starts"
              : "Live view needs the venue Wi-Fi"}
          </Text>
          {!scheduled ? (
            <Text className="text-muted-foreground text-center text-[12.5px]">
              Recording isn't affected — the game is still being saved.
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
};

export default LivePanel;
