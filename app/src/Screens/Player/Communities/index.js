import { UsersRound } from "lucide-react-native";
import { View } from "react-native";
import { EmptyState } from "@/components/pattern";
import ScreenHeader from "@/components/ScreenHeader";

/** PLAN-009 Communities tab — filled in by phase D (venue communities and player clubs). */
const CommunitiesScreen = () => (
  <View className="bg-background flex-1">
    <ScreenHeader title="Communities" />
    <EmptyState
      icon={UsersRound}
      title="Communities are coming"
      message="Join your venue's community or start a club with your playing group."
    />
  </View>
);

export default CommunitiesScreen;
