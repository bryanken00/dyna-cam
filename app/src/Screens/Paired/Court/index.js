import { useNavigation, useRoute } from "@react-navigation/native";
import { Film, Save, Square } from "lucide-react-native";
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import ConnectionBanner from "@/components/ConnectionBanner";
import ElapsedTimer from "@/components/ElapsedTimer";
import DotsLoader from "@/components/Loading/DotsLoader";
import QueryState from "@/components/QueryState";
import ScreenHeader from "@/components/ScreenHeader";
import StatusChip from "@/components/StatusChip";
import { SectionLabel } from "@/components/pattern";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Text } from "@/components/ui/text";
import { useThemeColors } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import { formatTime } from "@/utils/dynaCam";
import { pairedCourtState } from "../courtState";
import RecentRow from "./RecentRow";
import { usePairedCourt } from "./usePairedCourt";

/** The red "end" face of the big button, with the running timer. */
const EndFace = ({ m }) => {
  const colors = useThemeColors();
  const rec = m.recording;
  return (
    <>
      <View className="flex-row items-center gap-2">
        <View className="bg-destructive-foreground h-3.5 w-3.5 rounded-full" />
        <Text className="text-destructive-foreground font-sans-semibold text-[15px] uppercase tracking-[0.1em]">
          Recording
        </Text>
      </View>
      <ElapsedTimer
        seconds={rec.elapsedSeconds}
        since={m.recordingSince}
        limit={
          rec.endsInSeconds != null
            ? rec.elapsedSeconds + rec.endsInSeconds
            : undefined
        }
        // It stopped by itself — re-read the court so the button resets
        onLimit={m.refresh}
        className="text-destructive-foreground text-[52px] leading-tight"
      />
      {m.ending ? (
        <View className="flex-row items-center gap-2">
          <Text className="text-destructive-foreground font-sans-bold text-[26px]">
            Ending
          </Text>
          <DotsLoader color={colors.destructiveForeground} size={22} />
        </View>
      ) : (
        <View className="flex-row items-center gap-2">
          <Square size={22} color={colors.destructiveForeground} fill={colors.destructiveForeground} />
          <Text className="text-destructive-foreground font-sans-bold text-[26px]">
            End recording
          </Text>
        </View>
      )}
      {rec.endAt ? (
        <Text className="text-destructive-foreground/90 text-center text-[14px]">
          {`Stops by itself at ${formatTime(rec.endAt)}`}
          {rec.startedBy ? ` · started by ${rec.startedBy}` : ""}
        </Text>
      ) : null}
    </>
  );
};

/** The "start" face of the big button. */
const StartFace = ({ m }) => {
  const colors = useThemeColors();
  const court = m.court;
  if (m.starting) {
    return (
      <>
        <DotsLoader color={colors.primaryForeground} size={28} />
        <Text className="text-primary-foreground font-sans-bold text-[30px]">
          Starting…
        </Text>
      </>
    );
  }
  return (
    <>
      {/* The universal "record" dot */}
      <View
        className={cn(
          "h-14 w-14 rounded-full border-4",
          m.canRecord
            ? "bg-destructive border-primary-foreground"
            : "bg-muted-foreground border-muted",
        )}
      />
      <Text
        className={cn(
          "font-sans-bold text-center text-[30px]",
          m.canRecord ? "text-primary-foreground" : "text-muted-foreground",
        )}
      >
        Start recording
      </Text>
      <Text
        className={cn(
          "text-center text-[15px]",
          m.canRecord ? "text-primary-foreground/80" : "text-muted-foreground",
        )}
      >
        {m.courtLoading
          ? "Checking the camera…"
          : m.canRecord
            ? "Records the whole game until you press End"
            : court?.hasCamera === false
              ? "No camera on this court — tell the manager"
              : "Camera offline — tell the manager"}
      </Text>
    </>
  );
};

/**
 * One court on a paired phone (PLAN-002 Phase D):
 *
 *  • the big button records the **whole game**: Start recording → a red
 *    End recording with the running timer and when it stops by itself.
 *    Start never asks; End asks first. After End, the game's QR opens.
 *  • **Save last 60 s** — the one-minute clip, as a smaller button.
 *  • **Recent** — games and clips, newest first; tap to show a QR again.
 */
const PairedCourtScreen = () => {
  const colors = useThemeColors();
  const navigation = useNavigation();
  const { courtId, courtName } = useRoute().params ?? {};
  const m = usePairedCourt(courtId);
  const court = m.court;
  const state = pairedCourtState(court);
  const isRecording = Boolean(m.recording);

  const confirmEnd = () =>
    Alert.alert("End recording?", "The game so far is saved.", [
      { text: "Keep recording", style: "cancel" },
      { text: "End recording", style: "destructive", onPress: m.endRecording },
    ]);

  const mainDisabled = isRecording
    ? m.ending
    : !m.canRecord || m.starting || m.courtLoading;

  return (
    <View className="bg-background flex-1">
      <ScreenHeader
        title={court?.name ?? courtName ?? "Court"}
        onBack={navigation.goBack}
      />

      {m.courtMissing ? (
        <QueryState
          title="This court isn't available"
          message="It may have been turned off in the Admin portal. Go back and pick another court."
        />
      ) : (
        <ScrollView
          contentContainerClassName="w-full max-w-[560px] self-center p-4 pb-10"
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={m.isRefreshing} onRefresh={m.refresh} />
          }
        >
          <ConnectionBanner error={m.connectionError} className="mb-4" />

          {/* ── Whole game: Start / End ── */}
          <Pressable
            onPress={isRecording ? confirmEnd : m.startRecording}
            disabled={mainDisabled}
            accessibilityRole="button"
            accessibilityLabel={
              isRecording
                ? "End recording. The game so far is saved."
                : "Start recording the whole game."
            }
            accessibilityState={{
              disabled: mainDisabled,
              busy: m.starting || m.ending,
            }}
            className={cn(
              "min-h-[220px] items-center justify-center gap-3 rounded-[28px] px-6 py-8",
              isRecording
                ? "bg-destructive active:opacity-90"
                : m.canRecord
                  ? "bg-primary active:opacity-90"
                  : "bg-muted",
            )}
          >
            {isRecording ? <EndFace m={m} /> : <StartFace m={m} />}
          </Pressable>

          {/* Start / End problems, inline — they need reading, not a toast */}
          {m.error || m.note ? (
            <Text
              className={cn(
                "mt-3 text-center text-[14px]",
                m.error ? "text-destructive" : "text-muted-foreground",
              )}
              accessibilityRole={m.error ? "alert" : undefined}
            >
              {m.error ?? m.note}
            </Text>
          ) : court && !isRecording ? (
            <View className="mt-3 items-center">
              <StatusChip label={state.label} tone={state.tone} />
            </View>
          ) : null}

          {/* ── 60-second clip ── */}
          <Button
            variant="outline"
            onPress={m.saveClip}
            disabled={!m.canRecord || m.savingClip}
            className="mt-4 h-14 flex-row gap-2"
            accessibilityState={{ disabled: !m.canRecord, busy: m.savingClip }}
          >
            {m.savingClip ? (
              <DotsLoader color={colors.foreground} />
            ) : (
              <>
                <Save size={18} color={colors.foreground} />
                <Text className="text-[16px]">Save last 60 s</Text>
              </>
            )}
          </Button>

          {/* ── Recent: games and clips ── */}
          <View className="mt-8">
            <SectionLabel>Recent</SectionLabel>
            <View className="border-border bg-card overflow-hidden rounded-[14px] border">
              {m.recentLoading ? (
                <View className="items-center py-8">
                  <DotsLoader color={colors.mutedForeground} />
                </View>
              ) : m.recent.length === 0 ? (
                <View className="items-center gap-2 px-6 py-8">
                  <Film size={22} color={colors.mutedForeground} />
                  <Text className="text-muted-foreground text-center text-[13px]">
                    No games or clips on this court yet.
                  </Text>
                </View>
              ) : (
                m.recent.map((entry, i) => (
                  <View key={entry.key}>
                    {i > 0 ? <Separator className="bg-line-soft" /> : null}
                    <RecentRow entry={entry} onPress={m.openQr} />
                  </View>
                ))
              )}
            </View>
            <Text className="text-muted-foreground mt-2 text-[12px]">
              Tap a game or clip to show its QR again.
            </Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
};

export default PairedCourtScreen;
