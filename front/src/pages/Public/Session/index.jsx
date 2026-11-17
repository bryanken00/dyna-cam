import {
  CalendarClock,
  CircleAlert,
  Cloud,
  Download,
  Loader2,
  Radio,
  RotateCcw,
  Share2,
} from "lucide-react";
import dayjs from "dayjs";
import { Button } from "@/components/ui/button";
import { useSessionPageHooks } from "./hooks";
import PublicLayout from "../../../components/layout/PublicLayout";
import ResultState from "../../../components/ResultState";
import Spinner from "../../../components/Spinner";
import StatusDot from "../../../components/StatusDot";
import { getImageUrl } from "../../../utils/upload";
import {
  SESSION_STATUS_TONE,
  formatDate,
  formatDateTime,
  formatTimeRange,
  partLabel,
} from "../../../utils/dynaCam";

const cardStyle = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-line)",
  borderRadius: "var(--radius-card)",
};

const noticeStyle = {
  ...cardStyle,
  borderRadius: 10,
  fontSize: 13.5,
  color: "var(--color-text-dark)",
};

/** Status sentence above the parts. */
const StatusNotice = ({ session, remaining, readyCount }) => {
  const { status } = session;
  if (status === "Scheduled") {
    return (
      <div className="flex items-start gap-2.5 px-3.5 py-3" style={noticeStyle}>
        <CalendarClock className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "var(--color-text-muted)" }} />
        <span>
          <strong className="font-semibold">
            Recording starts at {dayjs(session.startAt).format("h:mm A")}
          </strong>
          {!dayjs(session.startAt).isSame(dayjs(), "day") &&
            ` on ${formatDate(session.startAt)}`}
          . Keep this link — your footage appears here in 5-minute parts.
        </span>
      </div>
    );
  }
  if (status === "Recording") {
    return (
      <div className="flex items-start gap-2.5 px-3.5 py-3" style={noticeStyle}>
        <Radio className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "var(--color-error)" }} />
        <span>
          <strong className="font-semibold">Recording now.</strong> A new part
          is saved every 5 minutes
          {remaining > 0 && ` — ${remaining} still to come`}.
        </span>
      </div>
    );
  }
  if (status === "Processing") {
    return (
      <div className="flex items-start gap-2.5 px-3.5 py-3" style={noticeStyle}>
        <Loader2 className="w-4 h-4 mt-0.5 shrink-0 animate-spin" style={{ color: "var(--color-secondary-color)" }} />
        <span>
          <strong className="font-semibold">Recording finished.</strong> Saving
          the last parts — this page updates on its own.
        </span>
      </div>
    );
  }
  if (status === "Failed") {
    return (
      <div className="flex items-start gap-2.5 px-3.5 py-3" style={noticeStyle}>
        <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "var(--color-error)" }} />
        <span>
          <strong className="font-semibold">Some of this session couldn&apos;t be saved.</strong>{" "}
          {readyCount > 0
            ? "The parts that were saved are below."
            : "Please ask the front desk."}
        </span>
      </div>
    );
  }
  return null;
};

/** One part: video + Download when Ready, "Saving…" when Pending, a note otherwise. */
const PartCard = ({ part }) => {
  const videoSrc = getImageUrl(part.videoUrl);
  const downloadHref = getImageUrl(part.downloadUrl);
  return (
    <div className="overflow-hidden" style={cardStyle}>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <span className="font-semibold" style={{ fontSize: 14.5, color: "var(--color-text-dark)" }}>
            {partLabel(part.partIndex)}
          </span>
          <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
            {" · "}
            {formatTimeRange(part.windowStartAt, part.windowEndAt)}
          </span>
        </div>
        {part.status === "Pending" && (
          <span className="inline-flex items-center gap-1.5 shrink-0" style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
            <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "var(--color-secondary-color)" }} />
            Saving…
          </span>
        )}
      </div>

      {part.status === "Ready" && videoSrc && (
        <>
          <video
            key={videoSrc}
            src={videoSrc}
            poster={getImageUrl(part.thumbnailUrl) || undefined}
            controls
            playsInline
            preload="none"
            className="w-full block"
            style={{ aspectRatio: "16 / 9", background: "var(--color-surface-sunken)" }}
          />
          {downloadHref && (
            <div className="p-3">
              <Button asChild variant="outline" size="lg" className="h-11 w-full">
                <a href={downloadHref} download>
                  <Download />
                  Download {partLabel(part.partIndex).toLowerCase()}
                </a>
              </Button>
            </div>
          )}
        </>
      )}

      {part.status === "Failed" && (
        <p className="m-0 px-4 pb-3" style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
          This part couldn&apos;t be saved.
        </p>
      )}
      {part.status === "Expired" && (
        <p className="m-0 px-4 pb-3" style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
          This part has expired here.
          {part.driveUrl && (
            <>
              {" "}
              <a
                href={part.driveUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
                style={{ color: "var(--color-text-dark)" }}
              >
                Open it in Google Drive
              </a>
            </>
          )}
        </p>
      )}
    </div>
  );
};

/**
 * `/session/:shareToken` — a booked court session for the player: status, then
 * each 5-minute part as it is saved. Polls every 10 s while it is live.
 */
const SessionPage = () => {
  const {
    session,
    parts,
    remaining,
    readyCount,
    expiresAt,
    courtName,
    venueName,
    playerName,
    isLoading,
    isFetching,
    notFound,
    loadError,
    refetch,
    handleShare,
  } = useSessionPageHooks();

  if (isLoading) {
    return (
      <PublicLayout>
        <Spinner className="py-24" tip="Loading your session…" />
      </PublicLayout>
    );
  }

  if (notFound) {
    return (
      <PublicLayout>
        <ResultState
          status="404"
          title="This session link isn't valid"
          description="It may have been typed wrong, or the session was cancelled. Ask the front desk for help."
        />
      </PublicLayout>
    );
  }

  if (loadError || !session) {
    return (
      <PublicLayout>
        <ResultState
          status="error"
          title="Couldn't load this session"
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

  const logo = getImageUrl(session.venueLogoUrl);

  return (
    <PublicLayout>
      {/* Heading */}
      <div className="flex items-center gap-3 mb-1 min-w-0">
        {logo && (
          <img src={logo} alt="" className="object-contain shrink-0" style={{ maxHeight: 40, maxWidth: 96 }} />
        )}
        <div className="min-w-0">
          <h1
            className="m-0 font-semibold leading-tight truncate"
            style={{ fontSize: 20, letterSpacing: "-0.3px", color: "var(--color-text-dark)" }}
          >
            {courtName}
          </h1>
          <p className="m-0 truncate" style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
            {venueName}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 flex-wrap mt-3 mb-4">
        <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
          {playerName && (
            <div className="font-medium" style={{ color: "var(--color-text-dark)" }}>
              {playerName}
            </div>
          )}
          {formatDate(session.startAt)} · {formatTimeRange(session.startAt, session.endAt)}
        </div>
        <StatusDot tone={SESSION_STATUS_TONE[session.status] || "muted"}>
          {session.status}
        </StatusDot>
      </div>

      <StatusNotice session={session} remaining={remaining} readyCount={readyCount} />

      {/* CR-001: the whole game's folder in the venue's Google Drive */}
      {session.driveUrl && (
        <Button asChild variant="outline" size="lg" className="h-12 w-full mt-4">
          <a href={session.driveUrl} target="_blank" rel="noopener noreferrer">
            <Cloud />
            Open the whole game in Google Drive
          </a>
        </Button>
      )}

      {/* Parts, in order */}
      {parts.length > 0 && (
        <div className="mt-4 space-y-3">
          {parts.map((part) => (
            <PartCard key={part.partIndex} part={part} />
          ))}
        </div>
      )}

      {readyCount > 0 && (
        <div className="mt-4">
          <Button size="lg" className="h-12 w-full" onClick={handleShare}>
            <Share2 />
            Share this session
          </Button>
          {expiresAt && (
            <p className="m-0 mt-3 text-center" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
              Available until {formatDateTime(expiresAt)}
            </p>
          )}
        </div>
      )}
    </PublicLayout>
  );
};

export default SessionPage;
