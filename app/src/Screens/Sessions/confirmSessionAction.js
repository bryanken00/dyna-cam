import { Alert } from "react-native";
import { sessionActionsFor } from "./useSessionsModule";

/**
 * Asks before cancelling or ending a session — both are final. Shared with
 * the session's detail screen.
 */
const confirmSessionAction = (session, { onCancel, onEnd }) => {
  const { canCancel, canEnd } = sessionActionsFor(session);
  const buttons = [{ text: "Keep it", style: "cancel" }];
  if (canCancel) {
    buttons.push({
      text: "Cancel session",
      style: "destructive",
      onPress: () => onCancel(session.sessionId),
    });
  }
  if (canEnd) {
    buttons.push({
      text: "End now",
      style: "destructive",
      onPress: () => onEnd(session.sessionId),
    });
  }
  Alert.alert(
    canEnd ? "End this session?" : "Cancel this session?",
    canEnd
      ? `${session.courtName} stops recording now. The footage so far is still delivered.`
      : `Nothing will be recorded on ${session.courtName}, and its player link stops working.`,
    buttons,
  );
};

export default confirmSessionAction;
