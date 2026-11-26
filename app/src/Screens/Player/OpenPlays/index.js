import { Users } from "lucide-react-native";
import { View } from "react-native";
import { EmptyState } from "@/components/pattern";
import ScreenHeader from "@/components/ScreenHeader";

/** PLAN-009 Open plays tab — filled in by phase B (join, pay, waitlist, leave). */
const OpenPlaysScreen = () => (
  <View className="bg-background flex-1">
    <ScreenHeader title="Open plays" />
    <EmptyState
      icon={Users}
      title="Open plays are coming"
      message="Join a game at a venue near you and play with others. Coming in the next update."
    />
  </View>
);

export default OpenPlaysScreen;
