import { memo } from "react";
import { Pressable, View } from "react-native";
import ClipThumb from "@/components/ClipThumb";
import StatusChip from "@/components/StatusChip";
import { Text } from "@/components/ui/text";
import {
  CLIP_SOURCE_LABEL,
  CLIP_STATUS_TONE,
  PAYMENT_STATUS_TONE,
  formatDateTime,
  formatPeso,
} from "@/utils/dynaCam";

/** "Unpaid · ₱50" for a priced clip, "Free" / "Paid" otherwise. */
export const paymentLabel = (clip) =>
  clip.paymentStatus === "Unpaid"
    ? `Unpaid · ${formatPeso(clip.price)}`
    : clip.paymentStatus;

/**
 * One clip in the list:
 *
 *   ┌──────┐  Court 1 · Dink City
 *   │thumb │  Today, 2:30 PM
 *   └──────┘  [QR scan] [● Ready] [● Unpaid · ₱50]
 *
 * Memoised so paging and filter changes don't re-render every row.
 */
const ClipRow = ({ clip, onPress }) => (
  <Pressable
    onPress={() => onPress(clip)}
    accessibilityRole="button"
    accessibilityLabel={`${clip.courtName}, ${formatDateTime(clip.requestedAt)}, ${clip.status}`}
    className="flex-row items-center gap-3 px-4 py-3 active:bg-secondary/60"
  >
    <ClipThumb uri={clip.thumbnailUrl} width={76} />

    <View className="min-w-0 flex-1 gap-1">
      <Text className="font-sans-medium text-[14px]" numberOfLines={1}>
        {clip.courtName}
        <Text className="text-muted-foreground text-[12.5px]">
          {`  ·  ${clip.venueName}`}
        </Text>
      </Text>
      <Text className="text-muted-foreground text-[12.5px]" numberOfLines={1}>
        {formatDateTime(clip.requestedAt)}
      </Text>
      <View className="flex-row flex-wrap gap-1.5">
        <StatusChip
          label={CLIP_SOURCE_LABEL[clip.source] ?? clip.source}
          tone="muted"
        />
        <StatusChip
          label={clip.status}
          tone={CLIP_STATUS_TONE[clip.status] ?? "muted"}
        />
        {clip.paymentStatus && clip.paymentStatus !== "Free" ? (
          <StatusChip
            label={paymentLabel(clip)}
            tone={PAYMENT_STATUS_TONE[clip.paymentStatus] ?? "muted"}
          />
        ) : null}
      </View>
    </View>
  </Pressable>
);

export default memo(ClipRow);
