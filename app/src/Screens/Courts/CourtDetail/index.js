import { useNavigation, useRoute } from "@react-navigation/native";
import { CalendarPlus, Film, Save } from "lucide-react-native";
import { RefreshControl, ScrollView, View } from "react-native";
import { DetailCard, DetailRow } from "@/components/DetailCard";
import DotsLoader from "@/components/Loading/DotsLoader";
import QueryState from "@/components/QueryState";
import ScreenHeader from "@/components/ScreenHeader";
import ShareLink from "@/components/ShareLink";
import ShareLinkSheet from "@/components/ShareLinkSheet";
import StatusChip from "@/components/StatusChip";
import { SectionLabel } from "@/components/pattern";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { SCREEN_NAVIGATION } from "@/constants/navigations";
import { useThemeColors } from "@/hooks/useTheme";
import { courtState } from "../CourtRow";
import { useCourtDetail } from "./useCourtDetail";

/**
 * One court — what staff do standing next to it:
 *  • **Save clip now**: the court's last 60 seconds (same POST /clips as the
 *    web portal), then a full-screen QR of the clip's link for the player.
 *  • **Book a session**: opens the Sessions booking form on this court.
 *  • Its live state (camera, recorder box, stream) and the QR on its sign,
 *    handy during installs.
 */
const CourtDetailScreen = () => {
  const colors = useThemeColors();
  const navigation = useNavigation();
  const { courtId, courtName } = useRoute().params ?? {};
  const m = useCourtDetail(courtId);
  const court = m.court;

  const openClip = () => {
    const clipId = m.result?.clipId;
    m.closeResult();
    if (clipId) {
      navigation.navigate(SCREEN_NAVIGATION.Modules.ClipDetail, { clipId });
    }
  };

  const state = court ? courtState(court) : null;

  return (
    <View className="bg-background flex-1">
      <ScreenHeader
        title={court?.name ?? courtName ?? "Court"}
        onBack={navigation.goBack}
      />

      {!court ? (
        <QueryState
          loading={m.isLoading}
          title="Couldn't load this court"
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
            {/* ── Hero: where, and whether it can record ── */}
            <View className="border-border bg-card mb-5 rounded-[14px] border p-5">
              <Text className="text-muted-foreground text-[12.5px]" numberOfLines={1}>
                {court.venueName}
              </Text>
              <View className="mt-1 flex-row items-center justify-between gap-3">
                <Text className="font-sans-semibold shrink text-[22px]" numberOfLines={1}>
                  {court.name}
                </Text>
                <StatusChip label={state.label} tone={state.tone} />
              </View>

              {m.canSave ? (
                <>
                  <Button
                    onPress={m.save}
                    disabled={m.saving || Boolean(m.blockedReason)}
                    className="mt-5 h-[54px] flex-row gap-2"
                    accessibilityState={{
                      disabled: m.saving || Boolean(m.blockedReason),
                      busy: m.saving,
                    }}
                  >
                    {m.saving ? (
                      <>
                        <Text className="text-primary-foreground font-sans-bold text-[15.5px]">
                          Saving
                        </Text>
                        <DotsLoader color={colors.primaryForeground} />
                      </>
                    ) : (
                      <>
                        <Save size={18} color={colors.primaryForeground} />
                        <Text className="text-primary-foreground font-sans-bold text-[15.5px]">
                          Save clip now
                        </Text>
                      </>
                    )}
                  </Button>
                  <Text className="text-muted-foreground mt-2 text-center text-[12px]">
                    {m.blockedReason ?? "Saves the last 60 seconds on this court."}
                  </Text>
                </>
              ) : null}

              {m.canBook || m.canViewClips ? (
                <View className="mt-4 flex-row gap-3">
                  {m.canBook ? (
                    <Button
                      variant="outline"
                      onPress={() =>
                        navigation.navigate(SCREEN_NAVIGATION.Modules.Sessions, {
                          bookCourtId: court.courtId,
                        })
                      }
                      className="h-11 flex-1 flex-row gap-2"
                    >
                      <CalendarPlus size={16} color={colors.foreground} />
                      <Text>Book a session</Text>
                    </Button>
                  ) : null}
                  {m.canViewClips ? (
                    <Button
                      variant="outline"
                      onPress={() =>
                        navigation.navigate(SCREEN_NAVIGATION.Modules.Clips, {
                          venueId: court.venueId,
                          courtId: court.courtId,
                        })
                      }
                      className="h-11 flex-1 flex-row gap-2"
                    >
                      <Film size={16} color={colors.foreground} />
                      <Text>Clips</Text>
                    </Button>
                  ) : null}
                </View>
              ) : null}
            </View>

            {/* ── Live state ── */}
            <DetailCard title="Status">
              <DetailRow
                label="Camera"
                value={
                  <StatusChip
                    label={court.camera?.configured ? "Set up" : "Not set up"}
                    tone={court.camera?.configured ? "success" : "muted"}
                  />
                }
              />
              <DetailRow
                label="Recorder box"
                value={
                  <StatusChip
                    label={court.recorderOnline ? "Online" : "Offline"}
                    tone={court.recorderOnline ? "success" : "danger"}
                  />
                }
              />
              <DetailRow
                label="Live stream"
                value={
                  <StatusChip
                    label={court.stream?.enabled ? "On" : "Off"}
                    tone={court.stream?.enabled ? "success" : "muted"}
                  />
                }
              />
              <DetailRow label="Button code" value={court.buttonCode} mono />
              <DetailRow
                label="Court"
                value={
                  <StatusChip
                    label={court.status}
                    tone={court.status === "Active" ? "success" : "muted"}
                  />
                }
              />
            </DetailCard>

            {/* ── The QR printed on the court's sign ── */}
            <SectionLabel>Court sign</SectionLabel>
            <View className="border-border bg-card rounded-[14px] border p-4">
              <Text className="text-muted-foreground mb-3 text-[12.5px]">
                The page players reach by scanning this court's sign.
              </Text>
              <ShareLink url={court.qrUrl} collapsible />
            </View>
          </View>
        </ScrollView>
      )}

      <ShareLinkSheet
        open={Boolean(m.result)}
        onClose={m.closeResult}
        title={
          m.result?.merged ? "Already being saved" : "Saving the clip"
        }
        subtitle={court ? `${court.name} · the last 60 seconds` : undefined}
        url={m.result?.shareUrl}
        shareMessage={court ? `Your clip from ${court.name}` : undefined}
        note={
          m.result?.merged
            ? "A save on this court a few seconds ago already covers this moment — it's the same clip."
            : "It's ready in about a minute; the page updates by itself."
        }
        action={
          m.canViewClips ? { label: "Open clip", onPress: openClip } : undefined
        }
      />
    </View>
  );
};

export default CourtDetailScreen;
