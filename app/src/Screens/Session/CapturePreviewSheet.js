import { useEvent } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { Film } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import DotsLoader from "@/components/Loading/DotsLoader";
import { FormSheet } from "@/components/pattern";
import StatusToggle from "@/components/pattern/StatusToggle";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useThemeColors } from "@/hooks/useTheme";
import { formatElapsed, mediaUrl } from "@/utils/dynaCam";

/**
 * CR-013: play a finished save on the courtside device, so players see what
 * they saved. One video per camera on a two-camera court (Cam 1 / Cam 2).
 *
 * The link is the save's signed file link from the last poll, taken once when
 * the sheet opens (a later poll re-signs it; swapping the source would restart
 * the video). Native controls: play, pause, scrub, sound.
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
  });
  const { status } = useEvent(player, "statusChange", { status: player.status });

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
                nativeControls
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
