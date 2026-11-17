import { useNavigation } from "@react-navigation/native";
import { Banknote, CheckCircle2, Search, Ticket } from "lucide-react-native";
import {
  Alert,
  KeyboardAvoidingView,
  ScrollView,
  View,
} from "react-native";
import ClipThumb from "@/components/ClipThumb";
import { DetailCard, DetailRow } from "@/components/DetailCard";
import DotsLoader from "@/components/Loading/DotsLoader";
import ScreenHeader from "@/components/ScreenHeader";
import StatusChip from "@/components/StatusChip";
import StyledInput from "@/components/StyledInput";
import { EmptyState } from "@/components/pattern";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useThemeColors } from "@/hooks/useTheme";
import {
  CLIP_SOURCE_LABEL,
  CLIP_STATUS_TONE,
  PAYMENT_STATUS_TONE,
  formatDateTime,
  formatPayCode,
  formatPeso,
} from "@/utils/dynaCam";
import { useTakePayment } from "./useTakePayment";

/** Why a looked-up clip can't be paid for, in the words staff need. */
const notPayableReason = (clip) => {
  if (clip.paymentStatus === "Paid") return "This clip is already paid.";
  if (clip.paymentStatus === "Free") return "This clip is free — nothing to pay.";
  if (clip.status === "Expired") return "This clip has expired — don't take payment.";
  return "This clip could not be saved — don't take payment.";
};

/**
 * Take payment — cash at the front desk. The player reads out (or shows) the
 * pay code from their clip page; staff look it up, check it is the right
 * clip (court, time, thumbnail, price), and record the cash. The clip
 * unlocks for the player at once.
 *
 * Case and spaces in the code don't matter ("k7q m2p" = "K7QM2P").
 */
const TakePaymentScreen = () => {
  const colors = useThemeColors();
  const navigation = useNavigation();
  const m = useTakePayment();
  const clip = m.clip;

  const confirmRecord = () =>
    Alert.alert(
      `Record ${formatPeso(clip.price)} cash?`,
      `For the clip on ${clip.courtName}, ${formatDateTime(clip.requestedAt)}. Take the cash first.`,
      [
        { text: "Not yet", style: "cancel" },
        { text: "Record payment", onPress: m.recordPayment },
      ],
    );

  return (
    <View className="bg-background flex-1">
      <ScreenHeader title="Take payment" onBack={navigation.goBack} />

      <KeyboardAvoidingView className="flex-1" behavior="padding">
        <ScrollView
          contentContainerClassName="p-4 pb-10"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View className="w-full max-w-[440px] self-center">
            {m.done ? (
              // ── Done ──
              <View className="border-border bg-card items-center rounded-[14px] border p-6">
                <CheckCircle2 size={40} strokeWidth={1.8} color={colors.foreground} />
                <Text className="font-sans-semibold mt-3 text-[22px]">
                  {`${formatPeso(m.done.amount)} recorded`}
                </Text>
                <Text className="text-muted-foreground mt-1 text-center text-[13px]">
                  {`The clip on ${m.done.courtName} is unlocked — the player can watch and download it now.`}
                </Text>
                <Button onPress={m.reset} className="mt-6 h-12 w-full">
                  <Text>Take another payment</Text>
                </Button>
                <Button
                  variant="outline"
                  onPress={navigation.goBack}
                  className="mt-3 h-12 w-full"
                >
                  <Text>Done</Text>
                </Button>
              </View>
            ) : (
              <>
                {/* ── Code ── */}
                <StyledInput
                  label="Pay code"
                  value={m.code}
                  onChangeText={m.setCode}
                  placeholder="e.g. K7Q M2P"
                  autoCapitalize="characters"
                  returnKeyType="search"
                  onSubmitEditing={m.find}
                  error={m.codeError}
                  Icon={Ticket}
                />
                <Button
                  onPress={m.find}
                  disabled={m.looking}
                  className="h-[54px] flex-row gap-2"
                  accessibilityState={{ busy: m.looking }}
                >
                  {m.looking ? (
                    <DotsLoader color={colors.primaryForeground} />
                  ) : (
                    <>
                      <Search size={17} color={colors.primaryForeground} />
                      <Text className="text-primary-foreground font-sans-bold text-[15.5px]">
                        Find clip
                      </Text>
                    </>
                  )}
                </Button>

                {/* ── Result ── */}
                {m.lookupError && !m.looking ? (
                  <View className="border-border bg-card mt-5 rounded-[14px] border">
                    <EmptyState
                      icon={Ticket}
                      title="No clip found"
                      message={m.lookupError}
                    />
                  </View>
                ) : null}

                {clip && !m.lookupError ? (
                  <View className="mt-5">
                    <View className="border-border bg-card mb-5 rounded-[14px] border p-4">
                      <ClipThumb uri={clip.thumbnailUrl} className="w-full" />
                      <View className="mt-4 flex-row items-end justify-between gap-3">
                        <View className="min-w-0 shrink">
                          <Text className="font-sans-semibold text-[17px]" numberOfLines={1}>
                            {clip.courtName}
                          </Text>
                          <Text className="text-muted-foreground text-[12.5px]" numberOfLines={1}>
                            {`${clip.venueName} · ${formatDateTime(clip.requestedAt)}`}
                          </Text>
                        </View>
                        <Text className="font-sans-semibold text-[26px] leading-none">
                          {formatPeso(clip.price)}
                        </Text>
                      </View>
                    </View>

                    <DetailCard>
                      <DetailRow label="Pay code" value={formatPayCode(clip.payCode)} mono />
                      <DetailRow
                        label="Source"
                        value={CLIP_SOURCE_LABEL[clip.source] ?? clip.source}
                      />
                      <DetailRow
                        label="Clip"
                        value={
                          <StatusChip
                            label={clip.status}
                            tone={CLIP_STATUS_TONE[clip.status] ?? "muted"}
                          />
                        }
                      />
                      <DetailRow
                        label="Payment"
                        value={
                          <StatusChip
                            label={clip.paymentStatus}
                            tone={PAYMENT_STATUS_TONE[clip.paymentStatus] ?? "muted"}
                          />
                        }
                      />
                    </DetailCard>

                    {!m.payable ? (
                      <Text className="text-muted-foreground text-center text-[13px]">
                        {notPayableReason(clip)}
                      </Text>
                    ) : m.canRecord ? (
                      <Button
                        onPress={confirmRecord}
                        disabled={m.recording}
                        className="h-[54px] flex-row gap-2"
                        accessibilityState={{ busy: m.recording }}
                      >
                        {m.recording ? (
                          <DotsLoader color={colors.primaryForeground} />
                        ) : (
                          <>
                            <Banknote size={18} color={colors.primaryForeground} />
                            <Text className="text-primary-foreground font-sans-bold text-[15.5px]">
                              {`Record ${formatPeso(clip.price)} cash`}
                            </Text>
                          </>
                        )}
                      </Button>
                    ) : (
                      <Text className="text-muted-foreground text-center text-[13px]">
                        You can look clips up, but recording a payment needs the
                        Payments write permission.
                      </Text>
                    )}
                  </View>
                ) : null}
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

export default TakePaymentScreen;
