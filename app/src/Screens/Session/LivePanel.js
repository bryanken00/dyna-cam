import { useEvent } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { ChevronsRight, RotateCcw, Volume2, VolumeX, Wifi } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import DotsLoader from "@/components/Loading/DotsLoader";
import StatusToggle from "@/components/pattern/StatusToggle";
import { Text } from "@/components/ui/text";
import { useThemeColors } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import { useLiveSource } from "./useLiveSource";

/** After a playback error, try the same link again this often. */
const RETRY_MS = 15000;

/**
 * CR-014: each ⟲ goes back this far, up to REWIND_MAX_SECONDS — the box lists
 * about a minute (LIVE_DVR_SECONDS) and the live edge sits a few seconds in.
 */
const REWIND_STEP_SECONDS = 10;
const REWIND_MAX_SECONDS = 50;

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
 * CR-007: on a two-camera court (`live.cameras`) a Cam 1 | Cam 2 switch sits
 * above the video; one camera plays at a time, starting on Cam 1. Switching
 * only changes what this device plays — recording is never touched.
 *
 * CR-014: under the video, ⟲ 10 s goes back (again for 20, 30 … up to 50 s —
 * the box keeps about a minute in its live stream) and Live → returns to
 * live. "20 s behind" replaces the LIVE mark meanwhile. A camera switch or a
 * renewed link starts at live again. A box not yet updated lists only ~10 s,
 * so going further back stops at what it has.
 *
 * ⚠️ The link and the player's error can contain the link's `sig` — nothing
 * here logs either.
 */
const CAMERA_OPTIONS = [
  // Neutral dots: the switch picks a view, it isn't a status
  { value: "Cam 1", accent: false },
  { value: "Cam 2", accent: false },
];

/** The chosen camera's link, as a `live` object for useLiveSource. */
const chosenLive = (live, camera) => {
  const link = live?.cameras?.find((c) => c.camera === camera);
  return link ? { hlsUrl: link.hlsUrl, expiresAt: live.expiresAt } : live;
};

const LivePanel = ({ live, scheduled, className }) => {
  const colors = useThemeColors();
  const twoCameras = (live?.cameras?.length ?? 0) > 1;
  const [camera, setCamera] = useState(1);
  const source = useLiveSource(twoCameras ? chosenLive(live, camera) : live);
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

  // CR-014: how far behind live this device is (0 = live). A new source (camera
  // switch, renewed link) loads at the live edge, so it starts at 0 again
  const [behind, setBehind] = useState(0);
  useEffect(() => setBehind(0), [source]);

  const rewind = () => {
    if (behind >= REWIND_MAX_SECONDS) return;
    player.seekBy(-REWIND_STEP_SECONDS);
    player.play();
    setBehind((b) => Math.min(REWIND_MAX_SECONDS, b + REWIND_STEP_SECONDS));
  };
  const goLive = () => {
    if (!source) return;
    setBehind(0);
    // Reloading the live playlist is the dependable way back to its edge
    player
      .replaceAsync({ uri: source.uri, contentType: "hls" })
      .then(() => player.play())
      .catch(() => {});
  };

  const playing = Boolean(source) && status !== "error";
  const cameraName = twoCameras ? `Cam ${camera}` : null;

  return (
    <View className={cn("w-full gap-2.5", className)}>
      {twoCameras ? (
        <StatusToggle
          value={cameraName}
          onChange={(value) => setCamera(value === "Cam 2" ? 2 : 1)}
          options={CAMERA_OPTIONS}
        />
      ) : null}
      <View
        className="border-border w-full overflow-hidden rounded-[18px] border bg-black"
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
              accessibilityLabel={
                cameraName ? `Live video of the court, ${cameraName}` : "Live video of the court"
              }
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
            <View className="absolute left-3 top-3 flex-row items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1">
              {behind === 0 ? <View className="bg-destructive h-2 w-2 rounded-full" /> : null}
              <Text className="font-sans-semibold text-[11px] uppercase tracking-[0.08em] text-white">
                {behind > 0
                  ? `${behind} s behind${cameraName ? ` · ${cameraName}` : ""}`
                  : cameraName
                    ? `Live · ${cameraName}`
                    : "Live"}
              </Text>
            </View>
          </>
        ) : (
          <View className="bg-card flex-1 items-center justify-center gap-2 px-6">
            <Wifi size={26} color={colors.mutedForeground} strokeWidth={1.8} />
            <Text className="text-center font-sans-medium text-[15px]">
              {scheduled
                ? "Live view starts when recording starts"
                : source && cameraName
                  ? `No live video from ${cameraName} right now`
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

      {/* CR-014: "⟲ 10 s            Live →" */}
      {playing ? (
        <View className="flex-row items-center justify-between gap-3">
          <Pressable
            onPress={rewind}
            disabled={behind >= REWIND_MAX_SECONDS}
            accessibilityRole="button"
            accessibilityLabel={`Back ${REWIND_STEP_SECONDS} seconds`}
            accessibilityHint="See the last point again"
            className={cn(
              "border-border bg-card h-12 flex-row items-center gap-2 rounded-full border px-4 active:opacity-70",
              behind >= REWIND_MAX_SECONDS && "opacity-50",
            )}
          >
            <RotateCcw size={17} color={colors.foreground} />
            <Text className="font-sans-semibold text-[14px]">{REWIND_STEP_SECONDS} s</Text>
          </Pressable>

          <Pressable
            onPress={goLive}
            disabled={behind === 0}
            accessibilityRole="button"
            accessibilityLabel={behind === 0 ? "Watching live" : "Back to live"}
            accessibilityState={{ disabled: behind === 0 }}
            className={cn(
              "h-12 flex-row items-center gap-1.5 rounded-full px-4",
              behind === 0 ? "bg-transparent" : "bg-primary active:opacity-85",
            )}
          >
            {behind === 0 ? (
              <>
                <View className="bg-destructive h-2.5 w-2.5 rounded-full" />
                <Text className="text-destructive font-sans-semibold text-[14px]">Live</Text>
              </>
            ) : (
              <>
                <Text className="text-primary-foreground font-sans-semibold text-[14px]">
                  Live
                </Text>
                <ChevronsRight size={18} color={colors.primaryForeground} />
              </>
            )}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
};

export default LivePanel;
