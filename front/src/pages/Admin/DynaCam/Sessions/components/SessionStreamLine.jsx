import { Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import StatusDot from "../../../../../components/StatusDot";
import StreamPlatformIcon from "../../../../../components/StreamPlatformIcon";
import { confirm } from "../../../../../store/confirmStore";
import {
  STREAM_LAYOUT_LABEL,
  STREAM_PLATFORM_LABEL,
  streamStatusInfo,
} from "../../../../../utils/dynaCam";
import { useStopSessionStream } from "../../../../../services/requests/admin/sessions";

/**
 * The player's own live stream (PLAN-002 Phase G) as one detail-sheet value:
 * platform, status and the masked address (never the key), with Stop stream.
 * `stream` null → "No personal stream".
 *
 * @param {string} sessionId
 * @param {object|null} stream  { platform, status, message, maskedUrl, layout, updatedAt }
 * @param {boolean} canWrite    shows Stop stream
 */
const SessionStreamLine = ({ sessionId, stream, canWrite }) => {
  const stopMutation = useStopSessionStream();

  if (!stream) {
    return <span style={{ color: "var(--color-text-muted)" }}>No personal stream</span>;
  }

  const { label, tone } = streamStatusInfo(stream);
  const platform = STREAM_PLATFORM_LABEL[stream.platform] || stream.platform;

  const handleStop = async () => {
    const ok = await confirm({
      title: "Stop stream",
      description: `Stop the player's stream to ${platform}? The recording carries on. They can start it again from the court's device.`,
      confirmText: "Stop stream",
      cancelText: "Keep it",
      danger: true,
    });
    if (ok) stopMutation.mutate(sessionId);
  };

  return (
    <div className="min-w-0 space-y-1">
      <div
        className="flex items-center gap-1.5"
        style={{ fontWeight: 500, color: "var(--color-text-dark)" }}
      >
        <StreamPlatformIcon
          platform={stream.platform}
          className="w-3.5 h-3.5 shrink-0"
          style={{ color: "var(--color-text-muted)" }}
        />
        {platform}
        {stream.layout && (
          <span style={{ fontWeight: 400, color: "var(--color-text-muted)" }}>
            · {STREAM_LAYOUT_LABEL[stream.layout] || stream.layout}
          </span>
        )}
      </div>
      <StatusDot tone={tone}>{label}</StatusDot>
      {stream.maskedUrl && (
        <div
          className="font-mono break-all"
          style={{ fontSize: 11.5, color: "var(--color-text-muted)" }}
        >
          {stream.maskedUrl}
        </div>
      )}
      {canWrite && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-1"
          disabled={stopMutation.isPending}
          onClick={handleStop}
        >
          <Square />
          Stop stream
        </Button>
      )}
    </div>
  );
};

export default SessionStreamLine;
