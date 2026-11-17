import { Clock, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStreamPageHooks } from "./hooks";
import StreamKeyForm from "./components/StreamKeyForm";
import StreamStatusCard from "./components/StreamStatusCard";
import PublicLayout from "../../../components/layout/PublicLayout";
import ResultState from "../../../components/ResultState";
import Spinner from "../../../components/Spinner";
import StatusDot from "../../../components/StatusDot";
import {
  SESSION_STATUS_TONE,
  formatDate,
  formatTimeRange,
} from "../../../utils/dynaCam";

const FOOTER =
  "Your stream key is never shown again, and it is deleted when the game ends.";

/** "12 min" / "45 s" — how long the setup link still works. */
const formatLeft = (seconds) => {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return s >= 60 ? `${Math.ceil(s / 60)} min` : `${s} s`;
};

/**
 * `/stream/:code` — opened on the player's own phone from the QR on the
 * court's session device. The player streams their session to their own
 * Facebook / YouTube (or any RTMP server): pick the platform, paste the key,
 * then watch the status and Stop. Polls every 5 s while open.
 */
const StreamPage = () => {
  const {
    code,
    setup,
    stream,
    courtName,
    venueName,
    showForm,
    isChangingKey,
    isLoading,
    isFetching,
    notFound,
    notFoundMessage,
    loadError,
    refetch,
    handleChangeKey,
    handleKeepStream,
    handleSaved,
    handleStop,
    isStopping,
  } = useStreamPageHooks();

  if (isLoading) {
    return (
      <PublicLayout>
        <Spinner className="py-24" tip="Loading…" />
      </PublicLayout>
    );
  }

  if (notFound) {
    return (
      <PublicLayout>
        <ResultState
          status="404"
          icon={<Clock className="w-6 h-6" strokeWidth={1.8} />}
          title="This stream link isn't active"
          description={
            notFoundMessage ||
            "It has expired, or the game has ended. Ask for a new QR on the court's device."
          }
        />
      </PublicLayout>
    );
  }

  if (loadError && !setup) {
    return (
      <PublicLayout>
        <ResultState
          status="error"
          title="Couldn't load this page"
          description="Check your connection and try again."
          action={
            <Button onClick={() => refetch()} disabled={isFetching}>
              <RotateCcw />
              Try again
            </Button>
          }
        />
      </PublicLayout>
    );
  }

  return (
    <PublicLayout footer={FOOTER}>
      {/* Heading: Court · Venue · session time */}
      <h1
        className="m-0 font-semibold leading-tight truncate"
        style={{ fontSize: 20, letterSpacing: "-0.3px", color: "var(--color-text-dark)" }}
      >
        {courtName}
      </h1>
      <p className="m-0 truncate" style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
        {venueName}
      </p>
      <div className="flex items-center justify-between gap-3 flex-wrap mt-3 mb-5">
        <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
          {formatDate(setup?.startAt)} · {formatTimeRange(setup?.startAt, setup?.endAt)}
        </span>
        {setup?.sessionStatus && (
          <StatusDot tone={SESSION_STATUS_TONE[setup.sessionStatus] || "muted"}>
            {setup.sessionStatus}
          </StatusDot>
        )}
      </div>

      {showForm ? (
        <>
          <h2
            className="m-0 mb-1 font-semibold"
            style={{ fontSize: 16, color: "var(--color-text-dark)" }}
          >
            {isChangingKey ? "Change your stream key" : "Stream this game live"}
          </h2>
          <p className="m-0 mb-5" style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}>
            Send the court camera to your own Facebook or YouTube. It starts
            when recording starts and stops when the game ends.
          </p>
          <StreamKeyForm
            code={code}
            platform={stream?.platform}
            onSuccess={handleSaved}
            onCancel={stream ? handleKeepStream : undefined}
            onGone={refetch}
          />
          {!stream && Number(setup?.expiresInSeconds) > 0 && (
            <p
              className="m-0 mt-4 text-center"
              style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}
            >
              This link works for {formatLeft(setup.expiresInSeconds)} more —
              once your stream is saved, it keeps working until the game ends.
            </p>
          )}
        </>
      ) : (
        <StreamStatusCard
          stream={stream}
          setup={setup}
          onStop={handleStop}
          isStopping={isStopping}
          onChangeKey={handleChangeKey}
        />
      )}
    </PublicLayout>
  );
};

export default StreamPage;
