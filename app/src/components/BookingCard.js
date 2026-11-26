import * as WebBrowser from "expo-web-browser";
import { CalendarDays, ExternalLink, Video } from "lucide-react-native";
import { Linking, Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import { useThemeColors } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import { formatDay, formatTime } from "@/utils/dynaCam";

const GAME_STATUS = {
  Recording: "Recording now",
  Processing: "Saving the video…",
  Ready: "Video ready",
  Scheduled: "Not started",
  Waiting: "Not started",
  Failed: "Couldn't save the video",
};

const open = (url, inApp) => {
  if (!url) return;
  (inApp ? WebBrowser.openBrowserAsync(url) : Linking.openURL(url)).catch(() => {});
};

/**
 * One booking from the player's game log (GET /player/games, PLAN-006):
 * venue, court, day and time, status — and its games, each with its Google
 * Drive link once the video is there (CR-040: videos are only ever on Drive).
 * Tapping the booking opens its own page (pay, check in, cancel / move).
 */
const BookingCard = ({ booking, className }) => {
  const colors = useThemeColors();

  return (
    <View className={cn("border-border bg-card rounded-2xl border", className)}>
      <Pressable
        onPress={() => open(booking.bookingUrl, true)}
        disabled={!booking.bookingUrl}
        accessibilityRole="button"
        accessibilityHint="Opens the booking's page"
        className="flex-row items-start gap-3 p-4 active:bg-secondary"
      >
        <View className="border-border bg-secondary h-10 w-10 items-center justify-center rounded-xl border">
          <CalendarDays size={18} color={colors.foreground} />
        </View>
        <View className="flex-1">
          <Text className="font-sans-semibold text-[15px]" numberOfLines={1}>
            {booking.venueName}
          </Text>
          <Text className="text-muted-foreground mt-0.5 text-[13px]">
            {booking.courtName} · {formatDay(booking.startAt)} · {formatTime(booking.startAt)} –{" "}
            {formatTime(booking.endAt)}
          </Text>
          <Text className="text-muted-foreground mt-1 text-[12px]">
            {booking.status}
            {booking.paymentStatus && booking.paymentStatus !== booking.status
              ? ` · ${booking.paymentStatus}`
              : ""}
          </Text>
        </View>
        {booking.bookingUrl ? <ExternalLink size={15} color={colors.mutedForeground} /> : null}
      </Pressable>

      {booking.games?.length ? (
        <View className="border-border border-t px-4 py-2">
          {booking.games.map((game) => (
            <Pressable
              key={game.startAt}
              onPress={() => open(game.driveUrl, false)}
              disabled={!game.driveUrl}
              accessibilityRole={game.driveUrl ? "link" : undefined}
              className="flex-row items-center gap-2.5 py-2"
            >
              <Video size={15} color={game.driveUrl ? colors.link : colors.mutedForeground} />
              <Text className="flex-1 text-[13px]">
                Game {formatTime(game.startAt)} – {formatTime(game.endAt)}
              </Text>
              <Text
                className={cn(
                  "text-[12.5px]",
                  game.driveUrl ? "text-link font-sans-semibold" : "text-muted-foreground",
                )}
              >
                {game.driveUrl ? "Open in Drive" : GAME_STATUS[game.status] || game.status}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
};

export default BookingCard;
