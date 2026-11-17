import { Smartphone, Unlink } from "lucide-react-native";
import { Alert, View } from "react-native";
import { DetailCard, DetailRow } from "@/components/DetailCard";
import { FormSheet } from "@/components/pattern";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { IS_DEMO } from "@/constants";
import { VERSION } from "@/constants/version";
import { useThemeColors } from "@/hooks/useTheme";

/**
 * "This phone" — what it is paired to, and the way out.
 *
 * Unpairing revokes the phone on the server (POST /app/unpair) and forgets
 * the token here. If the phone is offline only the local part happens; the
 * web portal (Dyna Cam → Paired Apps) can still revoke it.
 */
const PairedSettingsSheet = ({ open, onClose, phoneName, venueName, onUnpair }) => {
  const colors = useThemeColors();

  const confirmUnpair = () =>
    Alert.alert(
      "Unpair this phone?",
      `It stops working for ${venueName ?? "this venue"} until it's paired again with a new key from the Admin portal.`,
      [
        { text: "Keep paired", style: "cancel" },
        { text: "Unpair", style: "destructive", onPress: onUnpair },
      ],
    );

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      icon={Smartphone}
      title="This phone"
      subtitle="Paired staff phone"
      footer={
        <Button onPress={onClose} className="h-12 flex-1">
          <Text>Done</Text>
        </Button>
      }
    >
      <View className="w-full max-w-[560px] self-center">
        <DetailCard title="Paired to">
          <DetailRow label="Phone name" value={phoneName ?? "-"} />
          <DetailRow label="Venue" value={venueName ?? "-"} />
          <DetailRow label="App version" value={IS_DEMO ? `${VERSION} (demo)` : VERSION} mono />
        </DetailCard>

        <Text className="text-muted-foreground mb-5 text-[12.5px]">
          The name is set in the Admin portal, where a manager can rename or
          revoke this phone.
        </Text>

        <Button
          variant="outline"
          onPress={confirmUnpair}
          className="border-destructive bg-destructive/10 h-12 flex-row gap-2"
        >
          <Unlink size={17} color={colors.destructive} />
          <Text className="text-destructive font-sans-semibold">
            Unpair this phone
          </Text>
        </Button>
      </View>
    </FormSheet>
  );
};

export default PairedSettingsSheet;
