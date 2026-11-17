import { AlertTriangle } from "lucide-react-native";
import { View } from "react-native";
import DotsLoader from "@/components/Loading/DotsLoader";
import { EmptyState } from "@/components/pattern";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useThemeColors } from "@/hooks/useTheme";

/**
 * The loading and error states of a screen that shows ONE record (a detail
 * screen) — lists use DataList's `empty` slot instead.
 *
 *   if (m.isLoading || m.isError) {
 *     return <QueryState loading={m.isLoading} onRetry={m.refresh}
 *              title="Couldn't load this clip" message={m.errorMessage} />;
 *   }
 *
 * The API's own message is shown when there is one ("Clip not found" is more
 * use than "check your connection").
 */
const QueryState = ({ loading, title = "Couldn't load this", message, onRetry }) => {
  const colors = useThemeColors();

  if (loading) {
    return (
      <View className="items-center py-20">
        <DotsLoader color={colors.mutedForeground} />
      </View>
    );
  }

  return (
    <EmptyState
      icon={AlertTriangle}
      title={title}
      message={message || "Check your connection and try again."}
      action={
        onRetry ? (
          <Button variant="outline" onPress={onRetry}>
            <Text>Try again</Text>
          </Button>
        ) : null
      }
    />
  );
};

export default QueryState;
