import { useKeepAwake } from "expo-keep-awake";
import { Square } from "lucide-react-native";
import { Alert, Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import ConnectionBanner from "@/components/ConnectionBanner";
import DotsLoader from "@/components/Loading/DotsLoader";
import QrCode from "@/components/QrCode";
import QueryState from "@/components/QueryState";
import TickingTimer from "@/components/TickingTimer";
import { Text } from "@/components/ui/text";
import { useThemeColors } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import { formatTime, isConnectionError, shortLink } from "@/utils/dynaCam";
import LivePanel from "./LivePanel";
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
          limit={(s.elapsedSeconds ?? 0) + (s.endsInSeconds ?? 0)}
          // Reached its end time — re-read, the Ended screen follows
          onLimit={m.refresh}
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
 * timer, and Stop recording.
 *
 * A landscape tablet puts video and QR side by side; a portrait phone stacks
 * them — video, QR, then Stop. The screen stays awake. Before a booked
 * session starts it says "Starts at 3:00 PM", with the QR already up.
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
    Alert.alert("Stop recording?", "The game so far is saved.", [
      { text: "Keep recording", style: "cancel" },
      { text: "Stop recording", style: "destructive", onPress: m.stop },
    ]);

  const stopBlock = s ? (
    <View>
      <Pressable
        onPress={confirmStop}
        disabled={!m.isRecording || m.stopping}
        accessibilityRole="button"
        accessibilityLabel="Stop recording. The game so far is saved."
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
              Stop recording
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
                {stopBlock}
              </View>
              <QrCard url={s.shareUrl} size={qrSize} className="flex-[2] self-start" />
            </View>
          ) : (
            <View className="w-full max-w-[560px] gap-4 self-center">
              <LivePanel live={m.live} scheduled={m.isScheduled} />
              <QrCard url={s.shareUrl} size={qrSize} />
              {stopBlock}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
};

export default SessionScreen;
