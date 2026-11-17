import { useNavigation, useRoute } from "@react-navigation/native";
import { ChevronRight, Film, QrCode } from "lucide-react-native";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import ConnectionBanner from "@/components/ConnectionBanner";
import DotsLoader from "@/components/Loading/DotsLoader";
import QueryState from "@/components/QueryState";
import ScreenHeader from "@/components/ScreenHeader";
import StatusChip from "@/components/StatusChip";
import { SectionLabel } from "@/components/pattern";
import { Separator } from "@/components/ui/separator";
import { Text } from "@/components/ui/text";
import { useThemeColors } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import {
  CLIP_SOURCE_LABEL,
  formatDateTime,
  formatPeso,
} from "@/utils/dynaCam";
import { pairedCourtState } from "../courtState";
import { usePairedCourt } from "./usePairedCourt";

/** Paired-API clip status → what staff read ("Pending" means still saving). */
export const appClipChip = (clip) => {
  switch (clip.status) {
    case "Pending":
      return { label: "Saving…", tone: "warning" };
    case "Ready":
      return { label: "Ready", tone: "success" };
    case "Failed":
      return { label: "Failed", tone: "danger" };
    default:
      return { label: clip.status, tone: "muted" };
  }
};

/** One recent clip — tap to show its QR again. */
const RecentClipRow = ({ clip, onPress }) => {
  const colors = useThemeColors();
  const chip = appClipChip(clip);
  const canShow = clip.status !== "Failed" && clip.status !== "Expired";
  return (
    <Pressable
      onPress={() => onPress(clip)}
      disabled={!canShow}
      accessibilityRole="button"
      accessibilityLabel={`Clip from ${formatDateTime(clip.requestedAt)}, ${chip.label}. Show its QR.`}
      className={cn(
        "min-h-[64px] flex-row items-center gap-3 px-4 py-3",
        canShow ? "active:bg-secondary/60" : "opacity-60",
      )}
    >
      <View className="min-w-0 flex-1 gap-1">
        <Text className="font-sans-medium text-[15px]" numberOfLines={1}>
          {formatDateTime(clip.requestedAt)}
        </Text>
        <View className="flex-row flex-wrap gap-1.5">
          <StatusChip label={chip.label} tone={chip.tone} />
          <StatusChip
            label={CLIP_SOURCE_LABEL[clip.source] ?? clip.source}
            tone="muted"
          />
          {clip.paymentStatus === "Unpaid" ? (
            <StatusChip label={`Unpaid · ${formatPeso(clip.price)}`} tone="warning" />
          ) : clip.paymentStatus === "Paid" ? (
            <StatusChip label="Paid" tone="success" />
          ) : null}
        </View>
      </View>
      {canShow ? (
        <View className="flex-row items-center gap-1">
          <QrCode size={18} color={colors.mutedForeground} />
          <ChevronRight size={18} color={colors.mutedForeground} />
        </View>
      ) : null}
    </Pressable>
  );
};

/**
 * One court on a paired phone: a huge **Record** button (saves the last 60
 * seconds, then shows the clip's QR full-screen for the player) and the
 * court's recent clips, each of which shows its QR again — for a player who
 * missed it the first time.
 */
const PairedCourtScreen = () => {
  const colors = useThemeColors();
  const navigation = useNavigation();
  const { courtId, courtName } = useRoute().params ?? {};
  const m = usePairedCourt(courtId);
  const court = m.court;
  const state = pairedCourtState(court);

  return (
    <View className="bg-background flex-1">
      <ScreenHeader title={court?.name ?? courtName ?? "Court"} onBack={navigation.goBack} />

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

          {/* ── Record ── */}
          <Pressable
            onPress={m.record}
            disabled={!m.canRecord || m.recording}
            accessibilityRole="button"
            accessibilityLabel="Record. Saves the last 60 seconds."
            accessibilityState={{
              disabled: !m.canRecord || m.recording,
              busy: m.recording,
            }}
            className={cn(
              "min-h-[200px] items-center justify-center gap-3 rounded-[28px] px-6 py-8",
              m.canRecord ? "bg-primary active:opacity-90" : "bg-muted",
            )}
          >
            {m.recording ? (
              <>
                <DotsLoader color={colors.primaryForeground} size={28} />
                <Text className="text-primary-foreground font-sans-bold text-[30px]">
                  Saving…
                </Text>
              </>
            ) : (
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
                    "font-sans-bold text-[34px]",
                    m.canRecord ? "text-primary-foreground" : "text-muted-foreground",
                  )}
                >
                  Record
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
                      ? "Saves the last 60 seconds"
                      : court?.hasCamera === false
                        ? "No camera on this court — tell the manager"
                        : "Camera offline — tell the manager"}
                </Text>
              </>
            )}
          </Pressable>

          {court ? (
            <View className="mt-3 items-center">
              <StatusChip label={state.label} tone={state.tone} />
            </View>
          ) : null}

          {/* ── Recent clips ── */}
          <View className="mt-8">
            <SectionLabel>Recent clips</SectionLabel>
            <View className="border-border bg-card overflow-hidden rounded-[14px] border">
              {m.recentLoading ? (
                <View className="items-center py-8">
                  <DotsLoader color={colors.mutedForeground} />
                </View>
              ) : m.recent.length === 0 ? (
                <View className="items-center gap-2 px-6 py-8">
                  <Film size={22} color={colors.mutedForeground} />
                  <Text className="text-muted-foreground text-center text-[13px]">
                    No clips on this court yet.
                  </Text>
                </View>
              ) : (
                m.recent.map((clip, i) => (
                  <View key={clip.clipId}>
                    {i > 0 ? <Separator className="bg-line-soft" /> : null}
                    <RecentClipRow clip={clip} onPress={(c) => m.openQr(c)} />
                  </View>
                ))
              )}
            </View>
            <Text className="text-muted-foreground mt-2 text-[12px]">
              Tap a clip to show its QR again.
            </Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
};

export default PairedCourtScreen;
