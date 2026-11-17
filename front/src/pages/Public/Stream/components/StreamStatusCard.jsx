import dayjs from "dayjs";
import { KeyRound, Loader2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import StreamPlatformIcon from "../../../../components/StreamPlatformIcon";
import {
  STREAM_PLATFORM_LABEL,
  streamStatusInfo,
} from "../../../../utils/dynaCam";

const DOT = {
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  error: "var(--color-error)",
  muted: "var(--color-text-muted)",
};

/** The line under the status — what happens next. */
const nextStep = (stream, setup) => {
  switch (stream?.status) {
    case "waiting":
      return setup?.startAt
        ? `Your stream starts by itself when recording starts at ${dayjs(setup.startAt).format("h:mm A")}.`
        : "Your stream starts by itself when recording starts.";
    case "starting":
      return "This usually takes 10–20 seconds.";
    case "live":
      return "It runs about 10 seconds behind the court, and stops by itself when the game ends.";
    case "error":
      return "Check the key is still valid, then use Change key to paste it again.";
    default:
      return null;
  }
};

/**
 * The player's stream as it is now: status, platform, masked address, and
 * Stop / Change key. Presentational — the page owns the actions.
 */
const StreamStatusCard = ({ stream, setup, onStop, isStopping, onChangeKey }) => {
  const { label, tone } = streamStatusInfo(stream);
  const hint = nextStep(stream, setup);

  return (
    <div
      className="overflow-hidden"
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-line)",
        borderRadius: "var(--radius-card)",
      }}
    >
      <div className="px-4 py-4" aria-live="polite">
        <div className="flex items-start gap-2.5">
          {stream?.status === "starting" ? (
            <Loader2
              className="w-4 h-4 mt-1 shrink-0 animate-spin"
              style={{ color: DOT.warning }}
            />
          ) : (
            <span
              aria-hidden="true"
              className="shrink-0"
              style={{
                width: 9,
                height: 9,
                marginTop: 8,
                borderRadius: "50%",
                background: DOT[tone],
                boxShadow: tone === "success" ? "0 0 10px rgba(34,197,94,.55)" : "none",
              }}
            />
          )}
          <div
            className="font-semibold break-words min-w-0"
            style={{ fontSize: 17, lineHeight: 1.35, color: "var(--color-text-dark)" }}
          >
            {label}
          </div>
        </div>
        {hint && (
          <p
            className="m-0 mt-1.5"
            style={{ fontSize: 13, color: "var(--color-text-secondary)" }}
          >
            {hint}
          </p>
        )}
      </div>

      <div
        className="px-4 py-3"
        style={{
          borderTop: "1px solid var(--color-line)",
          background: "var(--color-surface-sunken)",
        }}
      >
        <div
          className="flex items-center gap-2"
          style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-dark)" }}
        >
          <StreamPlatformIcon
            platform={stream?.platform}
            style={{ color: "var(--color-text-muted)" }}
          />
          {STREAM_PLATFORM_LABEL[stream?.platform] || stream?.platform}
        </div>
        {stream?.maskedUrl && (
          <div
            className="font-mono mt-1 break-all"
            style={{ fontSize: 12, color: "var(--color-text-muted)" }}
          >
            {stream.maskedUrl}
          </div>
        )}
      </div>

      <div className="p-3 space-y-2.5" style={{ borderTop: "1px solid var(--color-line)" }}>
        <Button
          type="button"
          variant="destructive"
          size="lg"
          className="h-12 w-full"
          disabled={isStopping}
          onClick={onStop}
        >
          {isStopping ? <Loader2 className="animate-spin" /> : <Square />}
          Stop streaming
        </Button>
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="h-11 w-full"
          disabled={isStopping}
          onClick={onChangeKey}
        >
          <KeyRound />
          Change key
        </Button>
      </div>
    </div>
  );
};

export default StreamStatusCard;
