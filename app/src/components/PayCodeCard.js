import { Banknote } from "lucide-react-native";
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { useThemeColors } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import { formatPayCode } from "@/utils/dynaCam";

/**
 * CR-015: in place of the download QR until the game is paid — the game's
 * code, large, to read out or show at the front desk. The QR replaces it by
 * itself once staff record the payment (the screen polls).
 *
 *   <PayCodeCard code={s.payment.payCode} />
 *   <PayCodeCard code={…} large />   // the Ended screen
 */
const PayCodeCard = ({ code, large = false, className }) => {
  const colors = useThemeColors();
  const spoken = String(code ?? "").split("").join(" ");
  return (
    <View
      className={cn(
        "border-border bg-card w-full items-center rounded-[18px] border",
        large ? "px-6 py-8" : "p-5",
        className,
      )}
    >
      <View className="bg-secondary h-12 w-12 items-center justify-center rounded-full">
        <Banknote size={22} color={colors.foreground} />
      </View>
      <Text
        className={cn(
          "font-sans-semibold mt-3 text-center",
          large ? "text-[22px]" : "text-[17px]",
        )}
      >
        Pay at the front desk to get your videos
      </Text>
      <View className="border-border bg-background mt-4 w-full items-center rounded-xl border border-dashed px-3 py-4">
        <Text
          className={cn("font-mono tracking-[3px]", large ? "text-[44px]" : "text-[34px]")}
          selectable
          accessibilityLabel={`Game code ${spoken}`}
        >
          {code ? formatPayCode(code) : "—"}
        </Text>
        <Text className="text-muted-foreground mt-1 text-center text-[13px]">
          Show this code to the staff
        </Text>
      </View>
      <Text className="text-muted-foreground mt-3 text-center text-[12.5px]">
        The download QR appears here once it&apos;s paid.
      </Text>
    </View>
  );
};

export default PayCodeCard;
