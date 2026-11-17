import { useNavigation, useRoute } from "@react-navigation/native";
import { ChevronRight, Square, XCircle } from "lucide-react-native";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import ClipThumb from "@/components/ClipThumb";
import { DetailCard, DetailRow } from "@/components/DetailCard";
import QueryState from "@/components/QueryState";
import ScreenHeader from "@/components/ScreenHeader";
import ShareLink from "@/components/ShareLink";
import StatusChip from "@/components/StatusChip";
import { SectionLabel } from "@/components/pattern";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Text } from "@/components/ui/text";
import { SCREEN_NAVIGATION } from "@/constants/navigations";
import { useThemeColors } from "@/hooks/useTheme";
import {
  CLIP_STATUS_TONE,
  SESSION_STATUS_TONE,
  formatDate,
  formatDuration,
  formatMinutes,
  formatTimeRange,
  partLabel,
} from "@/utils/dynaCam";
import { formatPhoneDisplay } from "@/utils/phoneFormat";
import confirmSessionAction from "../confirmSessionAction";
import { useSessionDetail } from "./useSessionDetail";

/**
 * One session: when and where, its progress, cancel / end, the player's
 * share link, and its 5-minute parts (each part is a clip — tap to open it).
 */
const SessionDetailScreen = () => {
  const colors = useThemeColors();
  const navigation = useNavigation();
  const { sessionId } = useRoute().params ?? {};
  const m = useSessionDetail(sessionId);
  const s = m.session;

  const progress =
    s && s.partsTotal > 0 ? Math.min(1, s.partsReady / s.partsTotal) : 0;

  return (
    <View className="bg-background flex-1">
      <ScreenHeader title={s ? s.courtName : "Session"} onBack={navigation.goBack} />

      {!s ? (
        <QueryState
          loading={m.isLoading}
          title="Couldn't load this session"
          message={m.errorMessage}
          onRetry={m.refresh}
        />
      ) : (
        <ScrollView
          contentContainerClassName="p-4 pb-10"
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={m.isRefreshing} onRefresh={m.refresh} />
          }
        >
          <View className="w-full max-w-[560px] self-center">
            {/* ── Hero ── */}
            <View className="border-border bg-card mb-5 rounded-[14px] border p-5">
              <View className="flex-row items-center justify-between gap-3">
                <Text className="text-muted-foreground shrink text-[12.5px]" numberOfLines={1}>
                  {s.venueName}
                </Text>
                <StatusChip
                  label={s.status}
                  tone={SESSION_STATUS_TONE[s.status] ?? "muted"}
                />
              </View>
              <Text className="font-sans-semibold mt-1 text-[20px]" numberOfLines={1}>
                {formatTimeRange(s.startAt, s.endAt)}
              </Text>
              <Text className="text-muted-foreground mt-0.5 text-[13px]">
                {`${formatDate(s.startAt)} · ${formatMinutes(s.durationMinutes)}`}
              </Text>

              {s.partsTotal > 0 && s.status !== "Scheduled" && s.status !== "Cancelled" ? (
                <View className="mt-4">
                  <View
                    className="bg-secondary h-2 overflow-hidden rounded-full"
                    accessibilityRole="progressbar"
                    accessibilityValue={{ min: 0, max: s.partsTotal, now: s.partsReady }}
                  >
                    <View
                      className="bg-accent h-full rounded-full"
                      style={{ width: `${Math.round(progress * 100)}%` }}
                    />
                  </View>
                  <Text className="text-muted-foreground mt-1.5 text-[12px]">
                    {`${s.partsReady} of ${s.partsTotal} parts ready`}
                  </Text>
                </View>
              ) : null}

              {s.failureReason ? (
                <Text className="text-destructive mt-3 text-[12.5px]">
                  {s.failureReason}
                </Text>
              ) : null}

              {m.canCancel || m.canEnd ? (
                <Button
                  variant="outline"
                  onPress={() =>
                    confirmSessionAction(s, {
                      onCancel: m.cancelSession,
                      onEnd: m.endSession,
                    })
                  }
                  disabled={m.busy}
                  className="border-destructive bg-destructive/10 mt-5 h-12 flex-row gap-2"
                >
                  {m.canEnd ? (
                    <Square size={16} color={colors.destructive} />
                  ) : (
                    <XCircle size={16} color={colors.destructive} />
                  )}
                  <Text className="text-destructive font-sans-semibold">
                    {m.busy ? "Working…" : m.canEnd ? "End now" : "Cancel session"}
                  </Text>
                </Button>
              ) : null}
            </View>

            <DetailCard title="Booking">
              <DetailRow label="Court" value={s.courtName} />
              <DetailRow label="Venue" value={s.venueName} />
              <DetailRow label="Player" value={s.playerName} />
              <DetailRow
                label="Mobile"
                value={s.phone ? formatPhoneDisplay(s.phone) : null}
                mono
              />
            </DetailCard>

            {/* ── Parts ── */}
            {m.parts.length ? (
              <View className="mb-5">
                <SectionLabel>Parts</SectionLabel>
                <View className="border-border bg-card overflow-hidden rounded-[14px] border">
                  {m.parts.map((part, i) => (
                    <View key={part.clipId}>
                      {i > 0 ? <Separator className="bg-line-soft" /> : null}
                      <Pressable
                        onPress={() =>
                          navigation.navigate(SCREEN_NAVIGATION.Modules.ClipDetail, {
                            clipId: part.clipId,
                          })
                        }
                        accessibilityRole="button"
                        accessibilityLabel={`${partLabel(part.partIndex)}, ${part.status}`}
                        className="flex-row items-center gap-3 px-4 py-3 active:bg-secondary/60"
                      >
                        <ClipThumb uri={part.thumbnailUrl} width={64} />
                        <View className="min-w-0 flex-1">
                          <Text className="font-sans-medium text-[14px]">
                            {partLabel(part.partIndex)}
                          </Text>
                          <Text className="text-muted-foreground text-[12.5px]" numberOfLines={1}>
                            {part.failureReason ||
                              (part.durationSeconds
                                ? formatDuration(part.durationSeconds)
                                : formatTimeRange(part.windowStartAt, part.windowEndAt))}
                          </Text>
                        </View>
                        <StatusChip
                          label={part.status}
                          tone={CLIP_STATUS_TONE[part.status] ?? "muted"}
                        />
                        <ChevronRight size={16} color={colors.mutedForeground} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {/* ── Share ── */}
            {s.status !== "Cancelled" ? (
              <>
                <SectionLabel>Player link</SectionLabel>
                <View className="border-border bg-card rounded-[14px] border p-4">
                  <ShareLink
                    url={s.shareUrl}
                    collapsible
                    shareMessage={`Your game on ${s.courtName}`}
                  />
                </View>
              </>
            ) : null}
          </View>
        </ScrollView>
      )}
    </View>
  );
};

export default SessionDetailScreen;
