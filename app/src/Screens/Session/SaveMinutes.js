import { Check, Minus, Play, Plus, Scissors, Trash2 } from "lucide-react-native";
import { useRef, useState } from "react";
import { Alert, Image, PanResponder, Pressable, View } from "react-native";
import DotsLoader from "@/components/Loading/DotsLoader";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import useNow from "@/hooks/useNow";
import { useThemeColors } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import { formatElapsed, mediaUrl, secondsSince } from "@/utils/dynaCam";
import CapturePreviewSheet from "./CapturePreviewSheet";

/** Steps of 15 seconds, from 1 minute (the API's minimum) up to the time played. */
const STEP_SECONDS = 15;
const MIN_SECONDS = 60;
/** What the player picks first: the last 2 minutes (or less, early in the game). */
const DEFAULT_SECONDS = 120;

/** 75 → "1 min 15 s", 120 → "2 min". */
const lengthText = (seconds) => {
  const m = Math.floor(seconds / 60);
  const r = seconds % 60;
  return r ? `${m} min ${r} s` : `${m} min`;
};

/** What to say when a save is refused or can't be sent. */
const saveErrorText = (error) => {
  if (!error || error.response?.status === 401) return null; // unpaired — moving on
  if (!error.response) return "Can't reach Dyna Cam — check the Wi-Fi and try again.";
  return error.response?.data?.message || "Couldn't save — try again.";
};

/**
 * The game so far as a track, 0:00 → now, with the last `seconds` lit up in
 * lime and a handle at its start: drag left for more, right for less, in
 * 15-second steps from 1 minute. Pure JS (PanResponder), so no native module.
 * Screen readers get an adjustable control (swipe up / down = ±15 s).
 */
const LengthTrack = ({ seconds, played, maxSeconds, onChange, disabled }) => {
  const trackRef = useRef(null);
  const geometry = useRef({ x: 0, width: 1 });
  // The track is the game so far, so the lit part is the share of it saved
  const fraction = played > 0 ? Math.min(1, seconds / played) : 0;

  const measure = () =>
    trackRef.current?.measureInWindow((x, _y, width) => {
      geometry.current = { x, width: Math.max(1, width) };
    });

  const pick = (pageX) => {
    const { x, width } = geometry.current;
    const fromRight = Math.min(width, Math.max(0, x + width - pageX));
    const picked = Math.round(((fromRight / width) * played) / STEP_SECONDS) * STEP_SECONDS;
    onChange(Math.min(maxSeconds, Math.max(MIN_SECONDS, picked)));
  };

  const responder = useRef(null);
  responder.current = PanResponder.create({
    onStartShouldSetPanResponder: () => !disabled,
    onMoveShouldSetPanResponder: () => !disabled,
    // Keep the drag when the finger wanders up or down (the screen scrolls)
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (event) => {
      measure();
      pick(event.nativeEvent.pageX);
    },
    onPanResponderMove: (_event, gesture) => pick(gesture.moveX),
  });

  return (
    <View
      ref={trackRef}
      onLayout={measure}
      {...responder.current.panHandlers}
      className="h-11 justify-center"
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="How much of the game to save"
      accessibilityValue={{ text: `The last ${lengthText(seconds)}` }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "increment") {
          onChange(Math.min(maxSeconds, seconds + STEP_SECONDS));
        } else if (event.nativeEvent.actionName === "decrement") {
          onChange(Math.max(MIN_SECONDS, seconds - STEP_SECONDS));
        }
      }}
    >
      <View className="bg-muted h-2.5 overflow-hidden rounded-full">
        <View
          className={cn("absolute bottom-0 right-0 top-0 rounded-full", disabled ? "bg-border" : "bg-accent")}
          style={{ width: `${fraction * 100}%` }}
        />
      </View>
      {!disabled ? (
        <View
          pointerEvents="none"
          className="border-card bg-primary absolute h-7 w-7 rounded-full border-[3px]"
          style={{ right: `${fraction * 100}%`, marginRight: -14 }}
        />
      ) : null}
    </View>
  );
};

/** A save's state in a few words: "In queue", "Saving 45%", "Finishing…", "Ready". */
const captureStateText = (capture) => {
  if (capture.status === "Queued") return "In queue";
  if (capture.status === "Saving") {
    if (capture.uploadPercent == null) return "Saving…";
    return capture.uploadPercent >= 99 ? "Finishing…" : `Saving ${capture.uploadPercent}%`;
  }
  return capture.status;
};

/** One save in the list: [▶ picture] "Save 2  8:00 – 10:00 · Ready" [🗑] — the picture plays it. */
const CaptureRow = ({ capture, onDelete, deleting, onPreview }) => {
  const colors = useThemeColors();
  const ready = capture.status === "Ready";
  const waiting = ["Queued", "Saving"].includes(capture.status);
  // CR-013 preview: a finished save with a video can be played on the device
  const playable = ready && capture.videos?.some((video) => video.videoUrl);
  const thumbnail = mediaUrl(capture.videos?.find((video) => video.thumbnailUrl)?.thumbnailUrl);

  const confirmDelete = () =>
    Alert.alert(
      `Delete Save ${capture.number}?`,
      waiting
        ? "It won't be made, and it won't appear on your game's page."
        : "Its video is removed from your game's page.",
      [
        { text: "Keep", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => onDelete(capture.captureId) },
      ],
    );

  return (
    <View className="border-line-soft flex-row items-center justify-between gap-3 border-t py-2">
      {playable ? (
        <Pressable
          onPress={() => onPreview(capture)}
          accessibilityRole="button"
          accessibilityLabel={`Play Save ${capture.number}`}
          className="h-[36px] w-[64px] items-center justify-center overflow-hidden rounded-md bg-black active:opacity-80"
        >
          {thumbnail ? (
            <Image
              source={{ uri: thumbnail }}
              style={{ position: "absolute", width: "100%", height: "100%" }}
              resizeMode="cover"
              accessible={false}
            />
          ) : null}
          <View className="h-6 w-6 items-center justify-center rounded-full bg-black/55">
            <Play size={12} color="#fff" fill="#fff" />
          </View>
        </Pressable>
      ) : null}
      <Text className="flex-1 text-[14px]" numberOfLines={1}>
        <Text className="font-sans-semibold text-[14px]">Save {capture.number}</Text>
        {"  "}
        {formatElapsed(capture.fromSeconds)} – {formatElapsed(capture.toSeconds)}
      </Text>
      <View className="flex-row items-center gap-1.5">
        {ready ? <Check size={15} color={colors.link} strokeWidth={2.4} /> : null}
        <Text
          className={cn(
            "text-[13px]",
            ready
              ? "text-link font-sans-semibold"
              : waiting
                ? "text-muted-foreground"
                : "text-destructive",
          )}
        >
          {captureStateText(capture)}
        </Text>
      </View>

      {capture.captureId ? (
        <Pressable
          onPress={confirmDelete}
          disabled={deleting}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`Delete Save ${capture.number}`}
          className="h-10 w-10 items-center justify-center rounded-full active:opacity-60"
        >
          {deleting ? (
            <DotsLoader color={colors.mutedForeground} />
          ) : (
            <Trash2 size={18} color={colors.mutedForeground} />
          )}
        </Pressable>
      ) : null}
    </View>
  );
};

/**
 * CR-013: "Save the last N min" on the game screen. The track is the game so
 * far (0:00 → now); the player picks how much of the end to keep — 15-second
 * steps from 1 minute up to the time played — and taps Save. Each save becomes
 * its own video (one per camera), made by the recorder box like the whole
 * game, one at a time ("In queue" until its turn), and shows up on the game's
 * page — the QR. Up to `capture.maxPerGame` (5) at once; each can be deleted.
 *
 * Played time ticks from the API's `elapsedSeconds` + the time since that
 * answer (`since`), never from the device clock against an API time.
 */
const SaveMinutes = ({ session, since, capture, captures, save, removeCapture }) => {
  const colors = useThemeColors();
  const now = useNow(1000, Boolean(capture?.available));
  const played = Number(session.elapsedSeconds || 0) + secondsSince(since, now);
  // Whole 15-second steps of the time played, never under a minute
  const maxSeconds = Math.floor(played / STEP_SECONDS) * STEP_SECONDS;
  const [chosen, setChosen] = useState(DEFAULT_SECONDS);
  const seconds = Math.min(Math.max(MIN_SECONDS, chosen), Math.max(MIN_SECONDS, maxSeconds));
  const maxSaves = capture?.maxPerGame ?? 5;
  const used = capture?.used ?? captures?.length ?? 0;
  const full = used >= maxSaves;
  const canSave = Boolean(capture?.available) && maxSeconds >= MIN_SECONDS;
  const from = Math.max(0, played - seconds);
  const error = saveErrorText(save.error) ?? saveErrorText(removeCapture.error);
  const deletingId = removeCapture.isPending ? removeCapture.variables : null;
  // The save being previewed — a snapshot taken when it opens, so the video
  // doesn't restart when the next poll re-signs its link
  const [previewing, setPreviewing] = useState(null);

  const step = (delta) =>
    setChosen(Math.min(maxSeconds, Math.max(MIN_SECONDS, seconds + delta)));

  return (
    <View className="border-border bg-card rounded-[18px] border p-4">
      <View className="flex-row items-center gap-2">
        <Scissors size={17} color={colors.link} />
        <Text className="font-sans-semibold flex-1 text-[16px]">Save the last…</Text>
        <Text
          className={cn("text-[13px]", full ? "text-destructive" : "text-muted-foreground")}
          accessibilityLabel={`${used} of ${maxSaves} saves used`}
        >
          {used} of {maxSaves} saves
        </Text>
      </View>

      {canSave ? (
        <>
          <View className="mt-3 flex-row items-center justify-between gap-3">
            <Pressable
              onPress={() => step(-STEP_SECONDS)}
              disabled={seconds <= MIN_SECONDS}
              accessibilityRole="button"
              accessibilityLabel="15 seconds less"
              className="border-border h-11 w-11 items-center justify-center rounded-full border active:opacity-70"
            >
              <Minus
                size={18}
                color={seconds <= MIN_SECONDS ? colors.mutedForeground : colors.foreground}
              />
            </Pressable>
            <View className="items-center">
              <Text className="font-sans-bold text-[26px] tracking-tight">
                {lengthText(seconds)}
              </Text>
              <Text className="text-muted-foreground text-[13px]">
                {formatElapsed(from)} – {formatElapsed(played)}
              </Text>
            </View>
            <Pressable
              onPress={() => step(STEP_SECONDS)}
              disabled={seconds >= maxSeconds}
              accessibilityRole="button"
              accessibilityLabel="15 seconds more"
              className="border-border h-11 w-11 items-center justify-center rounded-full border active:opacity-70"
            >
              <Plus
                size={18}
                color={seconds >= maxSeconds ? colors.mutedForeground : colors.foreground}
              />
            </Pressable>
          </View>

          <View className="mt-2 px-3.5">
            <LengthTrack
              seconds={seconds}
              played={played}
              maxSeconds={maxSeconds}
              onChange={setChosen}
            />
            <View className="-mt-1 flex-row justify-between">
              <Text className="text-muted-foreground text-[12px]">0:00</Text>
              <Text className="text-muted-foreground text-[12px]">
                {formatElapsed(played)} now
              </Text>
            </View>
          </View>

          <Button
            onPress={() => {
              if (save.isPending) return;
              save.reset();
              save.mutate(seconds);
            }}
            disabled={save.isPending || full}
            className="mt-4 h-[52px] flex-row gap-2"
            accessibilityLabel={`Save the last ${lengthText(seconds)}`}
            accessibilityState={{ busy: save.isPending }}
          >
            {save.isPending ? (
              <DotsLoader color={colors.primaryForeground} />
            ) : (
              <Text className="text-primary-foreground font-sans-bold text-[16px]">
                Save {lengthText(seconds)}
              </Text>
            )}
          </Button>
          <Text
            className={cn(
              "mt-2 text-center text-[12.5px]",
              error ? "text-destructive" : "text-muted-foreground",
            )}
            accessibilityRole={error ? "alert" : undefined}
          >
            {error ??
              (full
                ? `That's ${maxSaves} saves — delete one to save another.`
                : "Its own video, on your game's page in a few minutes. Saves are made one at a time.")}
          </Text>
        </>
      ) : (
        <Text className="text-muted-foreground mt-2 text-[13.5px]">
          {capture?.available
            ? "You can save once the first minute has been played."
            : "Saving is available while the game is recording."}
        </Text>
      )}

      {captures?.length ? (
        <View className="mt-3">
          {captures
            .slice()
            .reverse()
            .map((item) => (
              <CaptureRow
                key={item.captureId ?? item.number}
                capture={item}
                deleting={deletingId === item.captureId}
                onPreview={setPreviewing}
                onDelete={(captureId) => {
                  removeCapture.reset();
                  removeCapture.mutate(captureId);
                }}
              />
            ))}
        </View>
      ) : null}

      <CapturePreviewSheet capture={previewing} onClose={() => setPreviewing(null)} />
    </View>
  );
};

export default SaveMinutes;
