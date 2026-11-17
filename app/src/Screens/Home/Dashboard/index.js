import { useNavigation } from "@react-navigation/native";
import {
  Banknote,
  CalendarClock,
  ChevronRight,
  Film,
  HardDrive,
  MapPin,
  Video,
} from "lucide-react-native";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import DotsLoader from "@/components/Loading/DotsLoader";
import QueryState from "@/components/QueryState";
import ScreenHeader from "@/components/ScreenHeader";
import { EmptyState, SectionLabel, StatCard } from "@/components/pattern";
import { Text } from "@/components/ui/text";
import { SCREEN_NAVIGATION } from "@/constants/navigations";
import { useThemeColors } from "@/hooks/useTheme";
import { useUserAuthStore } from "@/store/useUserAuthStore";
import { useDashboard } from "./useDashboard";

const DASH = "–";

/** A StatCard that opens the list behind its number. */
const StatLink = ({ onPress, label, ...card }) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={`${label}: ${card.value}`}
    className="min-w-[45%] flex-1 active:opacity-80"
  >
    <StatCard title={label} {...card} />
  </Pressable>
);

/** A full-width shortcut row: icon, title, caption, chevron. */
const Shortcut = ({ icon: Icon, title, caption, onPress }) => {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="border-border bg-card mb-3 flex-row items-center gap-3 rounded-[14px] border px-4 py-3.5 active:bg-secondary/60"
    >
      <View className="bg-primary h-10 w-10 items-center justify-center rounded-xl">
        <Icon size={19} color={colors.primaryForeground} strokeWidth={2} />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="font-sans-semibold text-[15px]">{title}</Text>
        <Text className="text-muted-foreground text-[12.5px]" numberOfLines={1}>
          {caption}
        </Text>
      </View>
      <ChevronRight size={18} color={colors.mutedForeground} />
    </Pressable>
  );
};

/**
 * Home tab — today at a glance for venue staff: clips saved today, clips
 * waiting for cash, sessions recording now, recorder boxes offline. Each
 * number opens its list; the shortcuts below are the jobs done most at the
 * desk. Cards the user's role can't read are left out, like the web sidebar.
 */
const Dashboard = () => {
  const colors = useThemeColors();
  const navigation = useNavigation();
  const firstName = useUserAuthStore((s) => s.user?.firstName);
  const m = useDashboard();
  const go = (route, params) => navigation.navigate(route, params);
  const show = (v) => (v === null ? DASH : v);

  const canCourts = m.can("venues", "courts");
  const canPayments = m.can("payments");
  const nothing = !m.canClips && !m.canDevices && !canCourts && !canPayments;

  return (
    <View className="bg-background flex-1">
      <ScreenHeader title="Dashboard" />

      <ScrollView
        contentContainerClassName="p-4 pb-10"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={m.isRefreshing} onRefresh={m.refresh} />
        }
      >
        <View className="w-full max-w-[720px] self-center">
          <Text className="font-sans-semibold text-[22px]">
            {firstName ? `Hi, ${firstName}` : "Today"}
          </Text>
          <Text className="text-muted-foreground mb-5 mt-0.5 text-[13px]">
            Pull down to refresh.
          </Text>

          {m.permissionsLoading ? (
            <View className="items-center py-14">
              <DotsLoader color={colors.mutedForeground} />
            </View>
          ) : m.permissionsError ? (
            <QueryState
              title="Couldn't load your access"
              onRetry={m.refresh}
            />
          ) : nothing ? (
            <View className="border-border bg-card rounded-[14px] border">
              <EmptyState
                icon={Video}
                title="Nothing to show yet"
                message="Your role has no Dyna Cam permissions. Ask an admin to add Courts, Clips or Payments to it."
              />
            </View>
          ) : (
            <>
              {m.canClips || m.canDevices ? (
                <View className="mb-6 flex-row flex-wrap gap-3">
                  {m.canClips ? (
                    <>
                      <StatLink
                        label="Clips today"
                        value={show(m.clipsToday)}
                        change="saved since midnight"
                        icon={Film}
                        onPress={() => go(SCREEN_NAVIGATION.Modules.Clips)}
                      />
                      <StatLink
                        label="Awaiting payment"
                        value={show(m.awaitingPayment)}
                        change="ready, unpaid"
                        icon={Banknote}
                        onPress={() =>
                          go(SCREEN_NAVIGATION.Modules.Clips, {
                            paymentStatus: "Unpaid",
                          })
                        }
                      />
                      <StatLink
                        label="Recording now"
                        value={show(m.recordingNow)}
                        change="sessions in progress"
                        icon={CalendarClock}
                        onPress={() => go(SCREEN_NAVIGATION.Modules.Sessions)}
                      />
                    </>
                  ) : null}
                  {m.canDevices ? (
                    <StatLink
                      label="Boxes offline"
                      value={show(m.boxesOffline)}
                      change={
                        m.boxesTotal === null
                          ? "recorder boxes"
                          : `of ${m.boxesTotal} recorder ${m.boxesTotal === 1 ? "box" : "boxes"}`
                      }
                      icon={HardDrive}
                      onPress={() => go(SCREEN_NAVIGATION.Modules.RecorderBoxes)}
                    />
                  ) : null}
                </View>
              ) : null}

              {m.anyError ? (
                <Text className="text-muted-foreground -mt-3 mb-5 text-[12px]">
                  Some numbers couldn't load ({DASH}). Pull down to try again.
                </Text>
              ) : null}

              {canCourts || canPayments ? (
                <>
                  <SectionLabel>At the court</SectionLabel>
                  {canCourts ? (
                    <Shortcut
                      icon={MapPin}
                      title="Courts"
                      caption="Save a clip now, book a session"
                      onPress={() => go(SCREEN_NAVIGATION.Modules.Courts)}
                    />
                  ) : null}
                  {canPayments ? (
                    <Shortcut
                      icon={Banknote}
                      title="Take payment"
                      caption="Unlock a player's clip by its pay code"
                      onPress={() => go(SCREEN_NAVIGATION.Modules.TakePayment)}
                    />
                  ) : null}
                </>
              ) : null}
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
};

export default Dashboard;
