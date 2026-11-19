import { useKeepAwake } from "expo-keep-awake";
import { Radio, Square } from "lucide-react-native";
import { Alert, Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import ConnectionBanner from "@/components/ConnectionBanner";
import DotsLoader from "@/components/Loading/DotsLoader";
import QrCode from "@/components/QrCode";
import QueryState from "@/components/QueryState";
import TickingTimer from "@/components/TickingTimer";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useThemeColors } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import { formatTime, isConnectionError, shortLink } from "@/utils/dynaCam";
import LivePanel from "./LivePanel";
import SaveMinutes from "./SaveMinutes";
import StreamChip from "./StreamChip";
import StreamSetupSheet from "./StreamSetupSheet";
import { useSessionScreen } from "./useSessionScreen";

/** Wide enough to put video and QR side by side (a landscape tablet). */
const SIDE_BY_SIDE_MIN_WIDTH = 700;

/** "● REC 12:34", or "Starts at 3:00 PM" before a booked session begins. */
const StatusPill = ({ m }) => {
  const s = m.session;
  if (m.isRecording) {
    return (
      <View className="bg-destructive flex-row items-center gap-2 rounded-full px-3.5 py-1.5">
        <View className="bg-destructive-foreground h-2.5 w-2.5 rounded-full" />
        <Text className="text-destructive-foreground font-sans-bold text-[14px]">REC</Text>
        <TickingTimer
          seconds={s.elapsedSeconds}
          since={m.since}
          // An open game (CR-005) has no end time: the timer just counts up
          limit={s.openEnded ? null : (s.elapsedSeconds ?? 0) + (s.endsInSeconds ?? 0)}
          // Reached its end time — re-read, the Ended screen follows
          onLimit={s.openEnded ? undefined : m.refresh}
          accessibilityLabel="Recording for"
          className="text-destructive-foreground text-[16px]"
        />
      </View>
    );
  }
  if (m.isScheduled) {
    return (
      <View className="border-border bg-card rounded-full border px-3.5 py-1.5">
        <Text className="font-sans-semibold text-[14px]">
          {`Starts at ${formatTime(s.startAt)}`}
        </Text>
      </View>
    );
  }
  return null;
};

/** The session's download QR — on screen the whole time. */
const QrCard = ({ url, size, className }) => (
  <View className={cn("border-border bg-card items-center rounded-[18px] border p-4", className)}>
    <Text className="mb-3 text-center font-sans-semibold text-[16px]">
      Scan to get your game
    </Text>
    <QrCode value={url} size={size} />
    <Text className="text-muted-foreground mt-3 text-center text-[13px]">
      Download it when the game ends
    </Text>
    <Text className="mt-1 text-center font-mono text-[12px]" numberOfLines={2} selectable>
      {shortLink(url)}
    </Text>
  </View>
);

/**
 * The session device's main screen (PLAN-002 Phase E): which court, the live
 * video from the venue's recorder box, the session's download QR, a REC
 * timer, and End game (CR-005: the game started when this device paired, and
 * only End game — or staff on the web — stops it).
 *
 * A landscape tablet puts video and QR side by side; a portrait phone stacks
 * them — video, QR, then Stop. The screen stays awake. Before a booked
 * session starts it says "Starts at 3:00 PM", with the QR already up.
 *
 * The player can also stream the session to their own Facebook / YouTube
 * (Phase G): a secondary button under Stop opens a QR for their phone; while
 * a stream is set up, a one-line strip under the header shows its state and
 * the buttons become Change stream / Stop streaming. It is deliberately
 * quieter than End game.
 *
 * While recording, "Save the last …" (CR-013, SaveMinutes) sits above End
 * game: pick the last N minutes, Save, and it becomes its own video on the
 * game's page.
 *
 * When the session ends (Stop, its end time, or staff on the web) the
 * navigator swaps to the Ended screen on the next answer.
 */
const SessionScreen = () => {
  useKeepAwake();
  const colors = useThemeColors();
  const { width, height } = useWindowDimensions();
  const m = useSessionScreen();
  const s = m.session;

  const sideBySide = width > height && width >= SIDE_BY_SIDE_MIN_WIDTH;
  const qrSize = sideBySide
    ? Math.min(height * 0.5, width * 0.3, 360)
    : Math.min(width - 72, 300);

  const confirmStop = () =>
    Alert.alert("End the game?", "Recording stops and the whole game is saved for the players.", [
      { text: "Keep recording", style: "cancel" },
      { text: "End game", style: "destructive", onPress: m.stop },
    ]);

  const confirmStopStream = () =>
    Alert.alert("Stop streaming?", "The recording keeps going.", [
      { text: "Keep streaming", style: "cancel" },
      { text: "Stop streaming", style: "destructive", onPress: m.stopStream },
    ]);

  // The player's own stream — secondary, below End game
  const streamBlock = m.canStream ? (
    <View>
      {m.stream ? (
        <View className="flex-row gap-3">
          <Button
            variant="outline"
            onPress={m.streamSetup.openSheet}
            className="h-12 flex-1"
          >
            <Text>Change stream</Text>
          </Button>
          <Button
            variant="outline"
            onPress={confirmStopStream}
            disabled={m.stoppingStream}
            className="h-12 flex-1"
            accessibilityState={{ busy: m.stoppingStream }}
          >
            {m.stoppingStream ? (
              <DotsLoader color={colors.foreground} />
            ) : (
              <Text className="text-destructive">Stop streaming</Text>
            )}
          </Button>
        </View>
      ) : (
        <Button
          variant="outline"
          onPress={m.streamSetup.openSheet}
          className="h-12 flex-row gap-2"
        >
          <Radio size={17} color={colors.foreground} />
          <Text>Stream to your Facebook / YouTube</Text>
        </Button>
      )}
      {m.streamError ? (
        <Text
          className="text-destructive mt-2 text-center text-[13px]"
          accessibilityRole="alert"
        >
          {m.streamError}
        </Text>
      ) : null}
    </View>
  ) : null;

  // CR-013: save the last few minutes as their own video
  const saveBlock =
    s && (m.isRecording || m.captures.length > 0) ? (
      <SaveMinutes
        session={s}
        since={m.since}
        capture={m.capture}
        captures={m.captures}
        save={m.save}
        removeCapture={m.removeCapture}
      />
    ) : null;

  const stopBlock = s ? (
    <View>
      <Pressable
        onPress={confirmStop}
        disabled={!m.isRecording || m.stopping}
        accessibilityRole="button"
        accessibilityLabel="End game. Recording stops and the game is saved."
        accessibilityState={{ disabled: !m.isRecording, busy: m.stopping }}
        className={cn(
          "min-h-[72px] flex-row items-center justify-center gap-3 rounded-[18px] px-6",
          m.isRecording ? "bg-destructive active:opacity-90" : "bg-muted",
        )}
      >
        {m.stopping ? (
          <DotsLoader color={colors.destructiveForeground} size={22} />
        ) : (
          <>
            <Square
              size={22}
              color={m.isRecording ? colors.destructiveForeground : colors.mutedForeground}
              fill={m.isRecording ? colors.destructiveForeground : colors.mutedForeground}
            />
            <Text
              className={cn(
                "font-sans-bold text-[22px]",
                m.isRecording ? "text-destructive-foreground" : "text-muted-foreground",
              )}
            >
              End game
            </Text>
          </>
        )}
      </Pressable>
      <Text
        className={cn(
          "mt-2 text-center text-[13px]",
          m.stopError ? "text-destructive" : "text-muted-foreground",
        )}
        accessibilityRole={m.stopError ? "alert" : undefined}
      >
        {m.stopError ??
          (m.isScheduled
            ? `Recording starts at ${formatTime(s.startAt)}`
            : s.openEnded
              ? "Recording until you press End game"
              : `Stops by itself at ${formatTime(s.endAt)}`)}
      </Text>
    </View>
  ) : null;

  return (
    // App.js already provides the safe area and the status bar
    <View className="bg-background flex-1">
      {/* ── Header: where, and what's happening ── */}
      <View className="border-border bg-card min-h-[64px] flex-row items-center gap-3 border-b px-4 py-2">
        <View className="min-w-0 flex-1">
          <Text className="font-sans-semibold text-[20px]" numberOfLines={1}>
            {s?.courtName ?? "Session"}
          </Text>
          {s?.venueName ? (
            <Text className="text-muted-foreground text-[13px]" numberOfLines={1}>
              {s.venueName}
            </Text>
          ) : null}
        </View>
        {s ? <StatusPill m={m} /> : null}
      </View>

      {/* The player's stream, one fixed-height line — only while one is set up */}
      {s && m.stream ? <StreamChip stream={m.stream} /> : null}

      {!s ? (
        m.isLoading || isConnectionError(m.error) ? (
          <View className="flex-1 items-center justify-center gap-4 p-6">
            <ConnectionBanner error={m.error} className="w-full max-w-[480px]" />
            <DotsLoader color={colors.mutedForeground} />
          </View>
        ) : (
          <QueryState
            title="Couldn't load the session"
            message={m.errorMessage}
            onRetry={m.refresh}
          />
        )
      ) : (
        <ScrollView
          contentContainerClassName="p-4 pb-8"
          showsVerticalScrollIndicator={false}
        >
          <ConnectionBanner error={m.error} className="mb-4" />

          {sideBySide ? (
            <View className="flex-row gap-5">
              <View className="flex-[3] gap-4">
                <LivePanel live={m.live} scheduled={m.isScheduled} />
                {saveBlock}
                {stopBlock}
                {streamBlock}
              </View>
              <QrCard url={s.shareUrl} size={qrSize} className="flex-[2] self-start" />
            </View>
          ) : (
            <View className="w-full max-w-[560px] gap-4 self-center">
              <LivePanel live={m.live} scheduled={m.isScheduled} />
              <QrCard url={s.shareUrl} size={qrSize} />
              {saveBlock}
              {stopBlock}
              {streamBlock}
            </View>
          )}
        </ScrollView>
      )}

      <StreamSetupSheet s={m.streamSetup} />
    </View>
  );
};

export default SessionScreen;
