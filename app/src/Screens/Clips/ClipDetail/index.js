import { useNavigation, useRoute } from "@react-navigation/native";
import { Banknote, Download, Play } from "lucide-react-native";
import { RefreshControl, ScrollView, View } from "react-native";
import ClipThumb from "@/components/ClipThumb";
import { DetailCard, DetailRow } from "@/components/DetailCard";
import QueryState from "@/components/QueryState";
import ScreenHeader from "@/components/ScreenHeader";
import ShareLink from "@/components/ShareLink";
import StatusChip from "@/components/StatusChip";
import { SectionLabel } from "@/components/pattern";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { SCREEN_NAVIGATION } from "@/constants/navigations";
import { useThemeColors } from "@/hooks/useTheme";
import {
  CLIP_SOURCE_LABEL,
  CLIP_STATUS_TONE,
  PAYMENT_STATUS_TONE,
  formatBytes,
  formatDateTime,
  formatDuration,
  formatPayCode,
  formatPeso,
  partLabel,
} from "@/utils/dynaCam";
import { useClipDetail } from "./useClipDetail";

/**
 * One clip: thumbnail, play / download (in the phone's own player — see
 * useClipDetail for why), the share link with a QR for the player, and
 * "Record cash" when it is unpaid, which hands over to Take payment with the
 * pay code filled in.
 */
const ClipDetailScreen = () => {
  const colors = useThemeColors();
  const navigation = useNavigation();
  const { clipId } = useRoute().params ?? {};
  const m = useClipDetail(clipId);
  const clip = m.clip;

  return (
    <View className="bg-background flex-1">
      <ScreenHeader
        title={clip ? clip.courtName : "Clip"}
        onBack={navigation.goBack}
      />

      {!clip ? (
        <QueryState
          loading={m.isLoading}
          title="Couldn't load this clip"
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
            {/* ── Video ── */}
            <View className="border-border bg-card mb-5 rounded-[14px] border p-4">
              <ClipThumb uri={clip.thumbnailUrl} className="w-full" />

              {clip.videoUrl ? (
                <>
                  <View className="mt-4 flex-row gap-3">
                    <Button onPress={m.play} className="h-12 flex-1 flex-row gap-2">
                      <Play size={17} color={colors.primaryForeground} />
                      <Text>Play video</Text>
                    </Button>
                    {clip.downloadUrl ? (
                      <Button
                        variant="outline"
                        onPress={m.download}
                        className="h-12 flex-1 flex-row gap-2"
                      >
                        <Download size={17} color={colors.foreground} />
                        <Text>Download</Text>
                      </Button>
                    ) : null}
                  </View>
                  <Text className="text-muted-foreground mt-2 text-center text-[12px]">
                    Opens in your phone's video player.
                  </Text>
                </>
              ) : (
                <Text className="text-muted-foreground mt-3 text-center text-[12.5px]">
                  {clip.status === "Failed"
                    ? clip.failureReason || "This clip could not be saved."
                    : clip.status === "Expired"
                      ? "This clip has expired and its video was removed."
                      : "The video is still being made — pull down to refresh."}
                </Text>
              )}
            </View>

            {/* ── Payment ── */}
            {m.canTakePayment ? (
              <View className="border-border bg-card mb-5 rounded-[14px] border p-4">
                <Text className="font-sans-semibold text-[15px]">
                  Waiting for payment
                </Text>
                <Text className="text-muted-foreground mt-1 text-[12.5px]">
                  The player sees the video once it is paid.
                </Text>
                <Button
                  onPress={() =>
                    navigation.navigate(SCREEN_NAVIGATION.Modules.TakePayment, {
                      payCode: clip.payCode,
                    })
                  }
                  className="mt-4 h-12 flex-row gap-2"
                >
                  <Banknote size={17} color={colors.primaryForeground} />
                  <Text>{`Record ${formatPeso(clip.price)} cash`}</Text>
                </Button>
              </View>
            ) : null}

            {/* ── Details ── */}
            <DetailCard title="Clip">
              <DetailRow label="Court" value={clip.courtName} />
              <DetailRow label="Venue" value={clip.venueName} />
              <DetailRow label="Saved" value={formatDateTime(clip.requestedAt)} />
              <DetailRow
                label="Source"
                value={CLIP_SOURCE_LABEL[clip.source] ?? clip.source}
              />
              <DetailRow
                label="Status"
                value={
                  <StatusChip
                    label={clip.status}
                    tone={CLIP_STATUS_TONE[clip.status] ?? "muted"}
                  />
                }
              />
              <DetailRow
                label="Length"
                value={
                  clip.durationSeconds ? formatDuration(clip.durationSeconds) : null
                }
                mono
              />
              <DetailRow
                label="Size"
                value={clip.sizeBytes ? formatBytes(clip.sizeBytes) : null}
                mono
              />
              <DetailRow
                label="Expires"
                value={clip.expiresAt ? formatDateTime(clip.expiresAt) : null}
              />
            </DetailCard>

            <DetailCard title="Payment">
              <DetailRow
                label="Payment"
                value={
                  <StatusChip
                    label={clip.paymentStatus}
                    tone={PAYMENT_STATUS_TONE[clip.paymentStatus] ?? "muted"}
                  />
                }
              />
              <DetailRow
                label="Price"
                value={clip.price > 0 ? formatPeso(clip.price) : "Free"}
              />
              <DetailRow
                label="Pay code"
                value={clip.payCode ? formatPayCode(clip.payCode) : null}
                mono
              />
            </DetailCard>

            {clip.sessionId && m.canOpenSession ? (
              <Button
                variant="outline"
                onPress={() =>
                  navigation.navigate(SCREEN_NAVIGATION.Modules.SessionDetail, {
                    sessionId: clip.sessionId,
                  })
                }
                className="mb-5 h-11"
              >
                <Text>{`Open session · ${partLabel(clip.partIndex)}`}</Text>
              </Button>
            ) : null}

            {/* ── Share ── */}
            <SectionLabel>Share link</SectionLabel>
            <View className="border-border bg-card rounded-[14px] border p-4">
              <ShareLink
                url={clip.shareUrl}
                collapsible
                shareMessage={`Your clip from ${clip.courtName}`}
              />
            </View>
          </View>
        </ScrollView>
      )}
    </View>
  );
};

export default ClipDetailScreen;
