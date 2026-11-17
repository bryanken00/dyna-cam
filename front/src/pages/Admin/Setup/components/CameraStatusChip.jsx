import StatusDot from "../../../../components/StatusDot";
import { cameraHealth } from "../../../../utils/dynaCam";

/**
 * A court's camera as its venue's recorder box sees it: Recording /
 * Connecting / Can't reach / No box online / Not set up. The box's message
 * is the tooltip.
 */
const CameraStatusChip = ({ camera }) => {
  const health = cameraHealth(camera);
  return (
    <StatusDot tone={health.tone} title={health.message || undefined}>
      {health.label}
    </StatusDot>
  );
};

export default CameraStatusChip;
