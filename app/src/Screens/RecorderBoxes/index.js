import { useNavigation } from "@react-navigation/native";
import {
  AlertTriangle,
  HardDrive,
  Wifi,
  WifiOff,
} from "lucide-react-native";
import { View } from "react-native";
import DotsLoader from "@/components/Loading/DotsLoader";
import ScreenHeader from "@/components/ScreenHeader";
import {
  DataList,
  EmptyState,
  FilterBar,
  ListFooter,
  StatCard,
} from "@/components/pattern";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useThemeColors } from "@/hooks/useTheme";
import DeviceRow from "./DeviceRow";
import { useRecorderBoxesModule } from "./useRecorderBoxesModule";

/**
 * Recorder boxes — read-only: is each venue's box online, when was it last
 * seen, and what is each of its cameras doing. Layout only: state lives in
 * useRecorderBoxesModule.
 */
const RecorderBoxesScreen = () => {
  const colors = useThemeColors();
  const navigation = useNavigation();
  const m = useRecorderBoxesModule();

  const emptySlot = m.isLoading ? (
    <View className="items-center py-14">
      <DotsLoader color={colors.mutedForeground} />
    </View>
  ) : m.isError ? (
    <EmptyState
      icon={AlertTriangle}
      title="Couldn't load recorder boxes"
      message="Check your connection and try again."
      action={
        <Button variant="outline" onPress={m.refresh}>
          <Text>Try again</Text>
        </Button>
      }
    />
  ) : (
    <EmptyState
      icon={HardDrive}
      title="No recorder boxes found"
      message={
        m.search
          ? "Try a different search."
          : "Boxes are added in the web portal, under Venues."
      }
    />
  );

  return (
    <View className="bg-background flex-1">
      <ScreenHeader title="Recorder boxes" onBack={navigation.goBack} />

      <DataList
        data={m.pageItems}
        keyExtractor={(item) => item.deviceId}
        onRefresh={m.refresh}
        refreshing={m.isRefreshing}
        renderItem={({ item }) => <DeviceRow device={item} />}
        ListHeaderComponent={
          m.stats ? (
            <View className="flex-row flex-wrap gap-3 pb-5">
              <StatCard
                title="Online"
                value={m.stats.online}
                change="heartbeat in the last 90s"
                icon={Wifi}
                className="min-w-[45%] flex-1"
              />
              <StatCard
                title="Offline"
                value={m.stats.offline}
                change="active boxes not reporting"
                icon={WifiOff}
                className="min-w-[45%] flex-1"
              />
            </View>
          ) : null
        }
        toolbar={
          <FilterBar
            value={m.search}
            onChangeText={m.setSearch}
            placeholder="Search boxes or venues…"
            onRefresh={m.refresh}
            refreshing={m.isRefreshing}
          />
        }
        empty={emptySlot}
        footer={
          <ListFooter
            page={m.page}
            pageSize={m.pageSize}
            total={m.total}
            noun="box"
            nounPlural="boxes"
            onChangePage={m.setPage}
          />
        }
      />
    </View>
  );
};

export default RecorderBoxesScreen;
