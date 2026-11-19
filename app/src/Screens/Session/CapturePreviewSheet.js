import { useEvent } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { Film, Pause, Play, RotateCcw, RotateCw } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, Pressable, View } from "react-native";
import DotsLoader from "@/components/Loading/DotsLoader";
import { FormSheet } from "@/components/pattern";
import StatusToggle from "@/components/pattern/StatusToggle";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useThemeColors } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import { formatElapsed, mediaUrl } from "@/utils/dynaCam";

/** −15 s / +15 s, like the save picker's steps. */
const JUMP_SECONDS = 15;

/**
 * The saved stretch as a track labelled in game time (8:00 … 10:00): the lit
 * part is what has played, the handle is where the video is. Drag or tap to
 * jump; screen readers get an adjustable control (±15 s). Pure JS.
 */
const ScrubTrack = ({ position, duration, onSeek, label }) => {
  const trackRef = useRef(null);
  const geometry = useRef({ x: 0, width: 1 });
  const fraction = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;

  const measure = () =>
    trackRef.current?.measureInWindow((x, _y, width) => {
      geometry.current = { x, width: Math.max(1, width) };
    });
  const seekTo = (pageX) => {
    const { x, width } = geometry.current;
    onSeek((Math.min(width, Math.max(0, pageX - x)) / width) * duration);
  };

  const responder = useRef(null);
  responder.current = PanResponder.create({
    onStartShouldSetPanResponder: () => duration > 0,
    onMoveShouldSetPanResponder: () => duration > 0,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (event) => {
      measure();
      seekTo(event.nativeEvent.pageX);
    },
    onPanResponderMove: (_event, gesture) => seekTo(gesture.moveX),
  });

  return (
    <View
      ref={trackRef}
      onLayout={measure}
      {...responder.current.panHandlers}
      className="h-10 justify-center"
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Where in the save"
      accessibilityValue={{ text: label }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(event) =>
        onSeek(
          position + (event.nativeEvent.actionName === "increment" ? JUMP_SECONDS : -JUMP_SECONDS),
        )
      }
    >
      <View className="bg-muted h-2 overflow-hidden rounded-full">
        <View
          className="bg-accent absolute bottom-0 left-0 top-0 rounded-full"
          style={{ width: `${fraction * 100}%` }}
        />
      </View>
      <View
        pointerEvents="none"
        className="border-card bg-primary absolute h-6 w-6 rounded-full border-[3px]"
        style={{ left: `${fraction * 100}%`, marginLeft: -12 }}
      />
    </View>
  );
};

/**
 * CR-013: play a finished save on the courtside device, so players see what
 * they saved. One video per camera on a two-camera court (Cam 1 / Cam 2).
 *
 * The link is the save's signed file link from the last poll, taken once when
 * the sheet opens (a later poll re-signs it; swapping the source would restart
 * the video). Below the video: a scrubber in game time ("now at 9:12 of the
 * game", 8:00 … 10:00), −15 s / play-pause / +15 s. Viewing only — the save
 * itself doesn't change.
 */
const CapturePreviewSheet = ({ capture, onClose }) => {
  const colors = useThemeColors();
  const ready = useMemo(
    () => (capture?.videos ?? []).filter((video) => video.status === "Ready" && video.videoUrl),
    [capture],
  );
  const [camera, setCamera] = useState(null);
  const chosen = ready.find((video) => video.camera === camera) ?? ready[0] ?? null;
  const uri = mediaUrl(chosen?.videoUrl);

  const player = useVideoPlayer(null, (p) => {
    p.loop = false;
    p.timeUpdateEventInterval = 0.25; // the scrubber's game-time readout
  });
  const { status } = useEvent(player, "statusChange", { status: player.status });
  const { isPlaying } = useEvent(player, "playingChange", { isPlaying: player.playing });
  const { currentTime } = useEvent(player, "timeUpdate", {
    currentTime: player.currentTime,
  });
  // The file's length; the save's own length until the video reports it
  const duration =
    Number.isFinite(player.duration) && player.duration > 0
      ? player.duration
      : Number(capture?.seconds || 0);
  const position = Math.min(duration, Math.max(0, Number(currentTime) || 0));
  const gameAt = (capture?.fromSeconds ?? 0) + position;

  const seek = (seconds) => {
    player.currentTime = Math.min(Math.max(0, seconds), Math.max(0, duration - 0.25));
  };
  const togglePlay = () => {
    if (isPlaying) {
      player.pause();
    } else {
      if (duration > 0 && position >= duration - 0.5) player.currentTime = 0; // replay
      player.play();
    }
  };

  // A new save opened, or another camera chosen: load it and play
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        if (uri) {
          await player.replaceAsync({ uri });
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
  }, [uri, player]);

  // Opening another save starts on its first camera
  useEffect(() => setCamera(null), [capture?.captureId]);

  const close = () => {
    player.pause();
    onClose();
  };

  const twoCameras = ready.length > 1;
  const options = ready.map((video) => ({ value: video.label, accent: false }));

  return (
    <FormSheet
      open={Boolean(capture)}
      onClose={close}
      icon={Film}
      title={capture ? `Save ${capture.number}` : "Save"}
      subtitle={
        capture
          ? `${formatElapsed(capture.fromSeconds)} – ${formatElapsed(capture.toSeconds)} of the game`
          : undefined
      }
      footer={
        <Button variant="outline" onPress={close} className="h-12 flex-1">
          <Text>Close</Text>
        </Button>
      }
    >
      <View className="w-full max-w-[640px] gap-3 self-center pt-1">
        {twoCameras ? (
          <StatusToggle
            value={chosen?.label}
            onChange={(label) =>
              setCamera(ready.find((video) => video.label === label)?.camera ?? null)
            }
            options={options}
          />
        ) : null}

        <View
          className="border-border w-full overflow-hidden rounded-[18px] border bg-black"
          style={{ aspectRatio: 16 / 9 }}
        >
          {uri ? (
            <>
              <VideoView
                player={player}
                style={{ width: "100%", height: "100%" }}
                contentFit="contain"
                nativeControls={false}
                allowsPictureInPicture={false}
                accessibilityLabel={
                  capture
                    ? `Save ${capture.number}${twoCameras ? `, ${chosen.label}` : ""}`
                    : "Saved video"
                }
              />
              {status === "loading" ? (
                <View
                  pointerEvents="none"
                  className="absolute inset-0 items-center justify-center"
                >
                  <DotsLoader color="#fff" />
                </View>
              ) : null}
            </>
          ) : (
            <View className="flex-1 items-center justify-center p-6">
              <Text className="text-center text-[14px] text-white/80">
                This save isn&apos;t ready to play yet.
              </Text>
            </View>
          )}
        </View>

        {/* Where in the game: the saved stretch, ±15 s, play / pause */}
        {uri && capture ? (
          <View className="border-border bg-card rounded-[18px] border px-4 pb-3 pt-2">
            <ScrubTrack
              position={position}
              duration={duration}
              onSeek={seek}
              label={`${formatElapsed(gameAt)} of the game`}
            />
            <View className="-mt-1 flex-row justify-between">
              <Text className="text-muted-foreground text-[12px]">
                {formatElapsed(capture.fromSeconds)}
              </Text>
              <Text className="font-sans-semibold text-[13px]">
                now at {formatElapsed(gameAt)} of the game
              </Text>
              <Text className="text-muted-foreground text-[12px]">
                {formatElapsed(capture.toSeconds)}
              </Text>
            </View>

            <View className="mt-3 flex-row items-center justify-center gap-4">
              <Pressable
                onPress={() => seek(position - JUMP_SECONDS)}
                accessibilityRole="button"
                accessibilityLabel="Back 15 seconds"
                className="border-border h-12 min-w-[76px] flex-row items-center justify-center gap-1.5 rounded-full border px-3 active:opacity-70"
              >
                <RotateCcw size={16} color={colors.foreground} />
                <Text className="text-[13.5px]">15 s</Text>
              </Pressable>
              <Pressable
                onPress={togglePlay}
                accessibilityRole="button"
                accessibilityLabel={isPlaying ? "Pause" : "Play"}
                className={cn(
                  "bg-primary h-14 w-14 items-center justify-center rounded-full active:opacity-85",
                )}
              >
                {isPlaying ? (
                  <Pause size={22} color={colors.primaryForeground} fill={colors.primaryForeground} />
                ) : (
                  <Play size={22} color={colors.primaryForeground} fill={colors.primaryForeground} />
                )}
              </Pressable>
              <Pressable
                onPress={() => seek(position + JUMP_SECONDS)}
                accessibilityRole="button"
                accessibilityLabel="Forward 15 seconds"
                className="border-border h-12 min-w-[76px] flex-row items-center justify-center gap-1.5 rounded-full border px-3 active:opacity-70"
              >
                <Text className="text-[13.5px]">15 s</Text>
                <RotateCw size={16} color={colors.foreground} />
              </Pressable>
            </View>
          </View>
        ) : null}

        {status === "error" ? (
          <Text className="text-destructive text-center text-[13px]" accessibilityRole="alert">
            Couldn&apos;t play it here — open it from the game&apos;s page (the QR).
          </Text>
        ) : (
          <Text className="text-muted-foreground text-center text-[12.5px]">
            Players get it from the game&apos;s page — the QR on this screen.
          </Text>
        )}
      </View>
    </FormSheet>
  );
};

export default CapturePreviewSheet;
