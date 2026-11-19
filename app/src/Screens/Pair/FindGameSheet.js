import { CheckCircle2, Clock, Search } from "lucide-react-native";
import { useWindowDimensions, View } from "react-native";
import DotsLoader from "@/components/Loading/DotsLoader";
import LinkText from "@/components/LinkText";
import { FormSheet } from "@/components/pattern";
import QrCode from "@/components/QrCode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useThemeColors } from "@/hooks/useTheme";
import { formatDay, formatPayCode, formatTime } from "@/utils/dynaCam";

/** "Court 1 · Dink City · Nov 19, 1:01 PM – 1:06 PM" */
const gameLine = (game) =>
  [
    game.courtName,
    game.venueName,
    game.startAt
      ? `${formatDay(game.startAt)}, ${formatTime(game.startAt)}${game.endAt ? ` – ${formatTime(game.endAt)}` : ""}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

/**
 * CR-015 "Find a game": after the courtside device unpaired, a player who has
 * paid comes back with their game's code — type it, and the device shows
 * that game's download QR. Before it's paid: "Not paid yet — pay at the front
 * desk". The code is the one the device and the game's page showed.
 */
const FindGameSheet = ({ f }) => {
  const colors = useThemeColors();
  const { width, height } = useWindowDimensions();
  const qrSize = Math.min(width - 96, height * 0.42, 340);
  const game = f.game;

  return (
    <FormSheet
      open={f.open}
      onClose={f.close}
      icon={Search}
      title="Find a game"
      subtitle="Type the game's code to show its download QR"
      footer={
        <Button variant="outline" onPress={f.close} className="h-12 flex-1">
          <Text>Close</Text>
        </Button>
      }
    >
      <View className="w-full max-w-[480px] gap-4 self-center pt-1">
        <View className="flex-row items-center gap-2">
          <Input
            value={f.code}
            onChangeText={f.setCode}
            onSubmitEditing={f.submit}
            placeholder="e.g. K7Q M2P"
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            returnKeyType="search"
            autoFocus
            className="h-[54px] flex-1 font-mono text-[22px] uppercase tracking-[2px]"
            accessibilityLabel="Game code"
          />
          <Button
            onPress={f.submit}
            disabled={!f.valid || f.searching}
            className="h-[54px] flex-row gap-2 px-5"
            accessibilityState={{ disabled: !f.valid, busy: f.searching }}
          >
            {f.searching ? (
              <DotsLoader color={colors.primaryForeground} />
            ) : (
              <>
                <Search size={18} color={colors.primaryForeground} />
                <Text className="text-primary-foreground font-sans-bold text-[15.5px]">Find</Text>
              </>
            )}
          </Button>
        </View>

        {f.error ? (
          <Text className="text-destructive text-center text-[13.5px]" accessibilityRole="alert">
            {f.error}
          </Text>
        ) : !game ? (
          <Text className="text-muted-foreground text-center text-[12.5px]">
            The code was on this screen during the game, and on the game&apos;s page.
          </Text>
        ) : null}

        {game ? (
          <View className="border-border bg-card items-center rounded-[18px] border p-5" accessibilityLiveRegion="polite">
            <Text className="text-muted-foreground text-center text-[13.5px]">
              {gameLine(game)}
            </Text>
            {game.shareUrl ? (
              <>
                <View className="mb-3 mt-2 flex-row items-center gap-2">
                  <CheckCircle2 size={20} color={colors.foreground} />
                  <Text className="font-sans-semibold text-[18px]">Paid — scan to download</Text>
                </View>
                <QrCode value={game.shareUrl} size={qrSize} />
                <LinkText url={game.shareUrl} className="mt-3 text-[12.5px]" />
              </>
            ) : (
              <>
                <View className="mt-2 flex-row items-center gap-2">
                  <Clock size={20} color={colors.foreground} />
                  <Text className="font-sans-semibold text-[18px]">Not paid yet</Text>
                </View>
                <Text className="text-muted-foreground mt-1 text-center text-[13.5px]">
                  Pay at the front desk with code{" "}
                  <Text className="text-foreground font-mono text-[13.5px]">
                    {formatPayCode(f.code)}
                  </Text>
                  , then tap Find again.
                </Text>
              </>
            )}
          </View>
        ) : null}
      </View>
    </FormSheet>
  );
};

export default FindGameSheet;
