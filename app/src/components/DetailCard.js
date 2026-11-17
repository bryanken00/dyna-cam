import { View } from "react-native";
import { SectionLabel } from "@/components/pattern";
import { Separator } from "@/components/ui/separator";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

/**
 * The read-only "label · value" card used by the detail screens (court,
 * clip, session).
 *
 *   <DetailCard title="Clip">
 *     <DetailRow label="Court" value={clip.courtName} />
 *     <DetailRow label="Status" value={<StatusChip … />} />
 *   </DetailCard>
 *
 * Rows are hairline-divided by the card; a row whose `value` is null or ""
 * is skipped, so optional fields need no `cond ? … : null` at the call site.
 */
export const DetailCard = ({ title, children, className }) => {
  const rows = (Array.isArray(children) ? children : [children])
    .flat()
    .filter(
      (c) =>
        c &&
        (c.type !== DetailRow ||
          (c.props.value !== null &&
            c.props.value !== undefined &&
            c.props.value !== "")),
    );

  return (
    <View className={cn("mb-5", className)}>
      {title ? <SectionLabel>{title}</SectionLabel> : null}
      <View className="border-border bg-card overflow-hidden rounded-[14px] border">
        {rows.map((row, i) => (
          <View key={row.props?.label ?? i}>
            {i > 0 ? <Separator className="bg-line-soft" /> : null}
            {row}
          </View>
        ))}
      </View>
    </View>
  );
};

/** One line of a DetailCard. `value` may be a string or a node (a chip). */
export const DetailRow = ({ label, value, mono = false }) => (
  <View className="min-h-[46px] flex-row items-center justify-between gap-4 px-4 py-2.5">
    <Text className="text-muted-foreground text-[13px]">{label}</Text>
    {typeof value === "string" || typeof value === "number" ? (
      <Text
        className={cn(
          "shrink text-right text-[13.5px]",
          mono ? "font-mono" : "font-sans-medium",
        )}
        numberOfLines={2}
        selectable
      >
        {value}
      </Text>
    ) : (
      <View className="shrink items-end">{value}</View>
    )}
  </View>
);

export default DetailCard;
