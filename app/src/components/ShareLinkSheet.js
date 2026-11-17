import { QrCode as QrIcon } from "lucide-react-native";
import { View } from "react-native";
import ShareLink from "@/components/ShareLink";
import { FormSheet } from "@/components/pattern";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";

/**
 * Full-screen "here's the link" result, shown right after something that
 * gives a player a link — "Save clip now", booking a session. The QR is big
 * and on top, so staff can turn the phone round and let the player scan it.
 *
 *   <ShareLinkSheet
 *     open={Boolean(result)}
 *     onClose={clear}
 *     title="Saving the clip"
 *     subtitle="Court 1 · the last 60 seconds"
 *     url={result?.shareUrl}
 *     note="Ready in about a minute — the page updates by itself."
 *     action={{ label: "Open clip", onPress: openClip }}
 *   />
 *
 * Reuses FormSheet's chrome; the footer is Done plus one optional action.
 */
const ShareLinkSheet = ({
  open,
  onClose,
  title,
  subtitle,
  url,
  note,
  shareMessage,
  action,
}) => (
  <FormSheet
    open={open}
    onClose={onClose}
    icon={QrIcon}
    title={title}
    subtitle={subtitle}
    footer={
      <>
        {action ? (
          <Button
            variant="outline"
            onPress={action.onPress}
            className="h-12 flex-1"
          >
            <Text>{action.label}</Text>
          </Button>
        ) : null}
        <Button onPress={onClose} className="h-12 flex-1">
          <Text>Done</Text>
        </Button>
      </>
    }
  >
    <View className="w-full max-w-[440px] self-center pt-2">
      <Text className="text-muted-foreground mb-4 text-center text-[13px]">
        Let the player scan this, or share the link to their phone.
      </Text>
      <ShareLink url={url} qrSize={260} shareMessage={shareMessage} />
      {note ? (
        <Text className="text-muted-foreground mt-5 text-center text-[12.5px]">
          {note}
        </Text>
      ) : null}
    </View>
  </FormSheet>
);

export default ShareLinkSheet;
