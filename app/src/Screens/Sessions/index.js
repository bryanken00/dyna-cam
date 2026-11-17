import { useNavigation } from "@react-navigation/native";
import { AlertTriangle, CalendarClock, Plus } from "lucide-react-native";
import { View } from "react-native";
import ChoiceChips from "@/components/ChoiceChips";
import DotsLoader from "@/components/Loading/DotsLoader";
import ScreenHeader from "@/components/ScreenHeader";
import ShareLinkSheet from "@/components/ShareLinkSheet";
import {
  DataList,
  EmptyState,
  Fab,
  FAB_CLEARANCE,
  FilterBar,
  ListFooter,
} from "@/components/pattern";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { SCREEN_NAVIGATION } from "@/constants/navigations";
import { useThemeColors } from "@/hooks/useTheme";
import {
  formatDayLabel,
  formatMinutes,
  formatTime,
} from "@/utils/dynaCam";
import BookSessionSheet from "./BookSessionSheet";
import confirmSessionAction from "./confirmSessionAction";
import SessionRow from "./SessionRow";
import { sessionActionsFor, useSessionsModule } from "./useSessionsModule";

const STATUS_OPTIONS = [
  { value: null, label: "Any status" },
  { value: "Recording", label: "Recording" },
  { value: "Scheduled", label: "Scheduled" },
  { value: "Processing", label: "Processing" },
  { value: "Ready", label: "Ready" },
  { value: "Failed", label: "Failed" },
  { value: "Cancelled", label: "Cancelled" },
];

/**
 * Sessions — courts booked for a whole game, with their status and how many
 * of their 5-minute parts are ready. Book one (Fab), cancel one that hasn't
 * started, or end one early. Layout only: state lives in useSessionsModule.
 */
const SessionsScreen = () => {
  const colors = useThemeColors();
  const navigation = useNavigation();
  const m = useSessionsModule();

  const openSession = (session) =>
    navigation.navigate(SCREEN_NAVIGATION.Modules.SessionDetail, {
      sessionId: session.sessionId,
    });

  const menuFor = (session) => {
    if (!m.canWrite) return undefined;
    const { canCancel, canEnd } = sessionActionsFor(session);
    return canCancel || canEnd
      ? () =>
          confirmSessionAction(session, {
            onCancel: m.cancelSession,
            onEnd: m.endSession,
          })
      : undefined;
  };

  const emptySlot = m.isLoading ? (
    <View className="items-center py-14">
      <DotsLoader color={colors.mutedForeground} />
    </View>
  ) : m.isError ? (
    <EmptyState
      icon={AlertTriangle}
      title="Couldn't load sessions"
      message="Check your connection and try again."
      action={
        <Button variant="outline" onPress={m.refresh}>
          <Text>Try again</Text>
        </Button>
      }
    />
  ) : (
    <EmptyState
      icon={CalendarClock}
      title="No sessions found"
      message={
        m.search || m.hasActiveFilters
          ? "Try a different search or clear your filters."
          : m.canWrite
            ? "Book a court to record a whole game."
            : "Booked sessions appear here."
      }
    />
  );

  return (
    <View className="bg-background flex-1">
      <ScreenHeader title="Sessions" onBack={navigation.goBack} />

      <DataList
        data={m.pageItems}
        keyExtractor={(item) => item.sessionId}
        onRefresh={m.refresh}
        refreshing={m.isRefreshing}
        contentContainerClassName={m.canWrite ? FAB_CLEARANCE : undefined}
        renderItem={({ item }) => (
          <SessionRow
            session={item}
            onPress={openSession}
            onMenu={menuFor(item)}
          />
        )}
        toolbar={
          <FilterBar
            value={m.search}
            onChangeText={m.setSearch}
            placeholder="Search player, court or venue…"
            onRefresh={m.refresh}
            refreshing={m.isRefreshing}
            onToggleFilters={() => m.setShowFilters(!m.showFilters)}
            filtersActive={m.showFilters || m.hasActiveFilters}
          >
            {m.showFilters ? (
              <ChoiceChips
                value={m.status}
                onChange={m.setStatus}
                options={STATUS_OPTIONS}
              />
            ) : null}
          </FilterBar>
        }
        empty={emptySlot}
        footer={
          <ListFooter
            page={m.page}
            pageSize={m.pageSize}
            total={m.total}
            noun="session"
            onChangePage={m.setPage}
          />
        }
      />

      {m.canWrite ? (
        <Fab label="Book session" icon={Plus} onPress={() => m.openBooking(null)} />
      ) : null}

      <BookSessionSheet
        open={m.booking !== null}
        onClose={m.closeBooking}
        onSubmit={m.save}
        courts={m.courts}
        courtsLoading={m.courtsLoading}
        initialCourtId={m.booking?.courtId}
        saving={m.saving}
      />

      <ShareLinkSheet
        open={m.booked !== null}
        onClose={m.closeBooked}
        title="Session booked"
        subtitle={
          m.booked
            ? `${m.booked.courtName} · ${formatDayLabel(m.booked.startAt?.slice(0, 10))}, ${formatTime(m.booked.startAt)} · ${formatMinutes(m.booked.durationMinutes)}`
            : undefined
        }
        url={m.booked?.shareUrl}
        shareMessage={
          m.booked ? `Your game on ${m.booked.courtName}` : undefined
        }
        note="Every 5-minute part shows up on this page as soon as it's ready."
      />
    </View>
  );
};

export default SessionsScreen;
