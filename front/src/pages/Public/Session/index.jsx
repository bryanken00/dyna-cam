import {
  CalendarClock,
  CircleAlert,
  Cloud,
  Download,
  Video,
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
  formatBytes,
  formatDate,
  formatMinutes,
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

/** Status sentence at the top: before, during, or when nothing could be recorded. */
const StatusNotice = ({ session }) => {
  const { status } = session;
  if (status === "Waiting") {
    // CR-005: the game starts when the court's device is set up
    return (
      <div className="flex items-start gap-2.5 px-3.5 py-3" style={noticeStyle}>
        <CalendarClock className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "var(--color-text-muted)" }} />
        <span>
          <strong className="font-semibold">Not started yet</strong> — recording starts when
          the court&apos;s device is set up. Keep this link: your whole game appears here as
          one video after it ends.
        </span>
      </div>
    );
  }
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
          . Keep this link — your whole game appears here as one video after it ends.
        </span>
      </div>
    );
  }
  if (status === "Recording") {
    // CR-004: nothing to watch until the game ends
    return (
      <div className="flex items-start gap-2.5 px-3.5 py-3" style={noticeStyle}>
        <Radio className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "var(--color-error)" }} />
        <span>
          <strong className="font-semibold">Recording now</strong> — your whole game
          appears here as one video when it ends.
        </span>
      </div>
    );
  }
  if (status === "Failed") {
    return (
      <div className="flex items-start gap-2.5 px-3.5 py-3" style={noticeStyle}>
        <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "var(--color-error)" }} />
        <span>
          <strong className="font-semibold">This game couldn&apos;t be recorded.</strong>{" "}
          Please ask the front desk.
        </span>
      </div>
    );
  }
  return null;
};

/**
 * CR-006: after End game — "Saving your game…" while the recorder box makes
 * the file, then "Saving your game… uploading 45%" with a bar.
 */
const SavingProgress = ({ percent }) => {
  const known = percent != null;
  return (
    <div className="p-4" style={{ ...cardStyle, borderRadius: 10 }} aria-live="polite">
      <div className="flex items-center gap-2" style={{ fontSize: 14.5, color: "var(--color-text-dark)" }}>
        <Loader2 className="w-4 h-4 shrink-0 animate-spin" style={{ color: "var(--color-secondary-color)" }} />
        <span className="font-semibold">
          {known ? `Saving your game… uploading ${percent}%` : "Saving your game…"}
        </span>
      </div>
      <div
        className="mt-3 overflow-hidden"
        role="progressbar"
        aria-label="Saving your game"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={known ? percent : undefined}
        style={{
          height: 6,
          borderRadius: 999,
          background: "var(--color-surface-sunken)",
          border: "1px solid var(--color-line)",
        }}
      >
        <div
          className="h-full transition-[width] duration-500 ease-out"
          style={{
            width: `${known ? Math.max(2, percent) : 2}%`,
            borderRadius: 999,
            background: "var(--color-secondary-color)",
          }}
        />
      </div>
      <p className="m-0 mt-2" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
        A long game can take a while to upload from the court. This page updates on its own —
        keep it open or come back to this link later.
      </p>
    </div>
  );
};

/** "8 minutes weren't recorded (11:23 – 11:31 AM)" for a whole video's gaps. */
const gapNote = (gaps) => {
  const seconds = gaps.reduce((sum, gap) => sum + dayjs(gap.endAt).diff(dayjs(gap.startAt), "second"), 0);
  const minutes = Math.max(1, Math.round(seconds / 60));
  const what = minutes === 1 ? "1 minute wasn't recorded" : `${minutes} minutes weren't recorded`;
  return `${what} (${gaps.map((gap) => formatTimeRange(gap.startAt, gap.endAt)).join(", ")})`;
};

/** CR-003: Cam 1 / Cam 2 switch above the whole video (two-camera courts). */
const CameraTabs = ({ videos, active, onSelect }) => (
  <div className="grid grid-cols-2 gap-2 mt-4" role="tablist" aria-label="Camera">
    {videos.map((video) => (
      <Button
        key={video.camera}
        role="tab"
        aria-selected={active?.camera === video.camera}
        variant={active?.camera === video.camera ? "default" : "outline"}
        className="h-10"
        onClick={() => onSelect(video.camera)}
      >
        <Video />
        {video.label}
      </Button>
    ))}
  </div>
);

/**
 * CR-003: the whole game as one video (per camera) — play, Download one file,
 * the stretches the camera missed, and the Google Drive copy.
 */
const WholeVideoCard = ({ video, twoCameras }) => {
  const videoSrc = getImageUrl(video.videoUrl);
  const downloadHref = getImageUrl(video.downloadUrl);
  const title = twoCameras ? `${video.label} — whole game` : "Whole game";
  const muted = { fontSize: 13, color: "var(--color-text-secondary)" };

  return (
    <div className="overflow-hidden mt-3" style={cardStyle}>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <span className="font-semibold" style={{ fontSize: 14.5, color: "var(--color-text-dark)" }}>
          {title}
        </span>
        {video.status === "Ready" && (
          <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
            {[
              video.durationSeconds ? formatMinutes(Math.round(video.durationSeconds / 60)) : null,
              video.sizeBytes ? formatBytes(video.sizeBytes) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        )}
      </div>

      {video.status === "Ready" && videoSrc && (
        <>
          <video
            key={videoSrc}
            src={videoSrc}
            poster={getImageUrl(video.thumbnailUrl) || undefined}
            controls
            playsInline
            preload="metadata"
            className="w-full block"
            style={{ aspectRatio: "16 / 9", background: "var(--color-surface-sunken)" }}
          />
          <div className="p-3 space-y-2">
            {downloadHref && (
              <Button asChild size="lg" className="h-11 w-full">
                <a href={downloadHref} download>
                  <Download />
                  {twoCameras ? `Download ${video.label}` : "Download whole game"}
                </a>
              </Button>
            )}
            {video.driveUrl && (
              <Button asChild variant="outline" size="lg" className="h-11 w-full">
                <a href={video.driveUrl} target="_blank" rel="noopener noreferrer">
                  <Cloud />
                  Open in Google Drive
                </a>
              </Button>
            )}
          </div>
        </>
      )}

      {video.gaps?.length > 0 && video.status === "Ready" && (
        <p className="m-0 px-4 pb-3" style={muted}>
          {gapNote(video.gaps)} — the camera wasn&apos;t recording then, so the video skips it.
        </p>
      )}
      {video.status === "Failed" && (
        <p className="m-0 px-4 pb-3" style={muted}>
          We&apos;re still putting your video together — check back soon.
        </p>
      )}
      {video.status === "Expired" && (
        <p className="m-0 px-4 pb-3" style={muted}>
          This video has expired here.
          {video.driveUrl && (
            <>
              {" "}
              <a
                href={video.driveUrl}
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
 * A game recorded before whole videos (it has no whole video): its saved
 * 5-minute pieces, as they were shown then. New games never show these.
 */
const PartCard = ({ part }) => {
  const videoSrc = getImageUrl(part.videoUrl);
  const downloadHref = getImageUrl(part.downloadUrl);
  return (
    <div className="overflow-hidden" style={cardStyle}>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <span className="font-semibold" style={{ fontSize: 14.5, color: "var(--color-text-dark)" }}>
            {partLabel(part.partIndex)}
            {part.camera > 0 && ` · Cam ${part.camera}`}
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
 * `/session/:shareToken` — a recorded game for the player: when it starts, that
 * it's recording, how much is saved after it ends, then the whole video per
 * camera (CR-003). Players never see parts (CR-004). Polls while anything changes.
 */
const SessionPage = () => {
  const {
    session,
    parts,
    videos,
    activeVideo,
    setCameraTab,
    twoCameras,
    saving,
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
          {session.status === "Waiting"
            ? "Waiting for the court's device"
            : !session.endAt
              ? `${formatDate(session.startAt)} · recording since ${dayjs(session.startAt).format("h:mm A")}`
              : `${formatDate(session.startAt)} · ${formatTimeRange(session.startAt, session.endAt)}`}
        </div>
        {/* "Ready" only once the whole video is there (CR-004) */}
        <StatusDot tone={saving ? "warning" : SESSION_STATUS_TONE[session.status] || "muted"}>
          {saving ? "Saving" : session.status}
        </StatusDot>
      </div>

      <StatusNotice session={session} />
      {saving && <SavingProgress percent={saving.percent} />}

      {/* CR-001: the whole game's folder in the venue's Google Drive */}
      {session.driveUrl && (
        <Button asChild variant="outline" size="lg" className="h-12 w-full mt-4">
          <a href={session.driveUrl} target="_blank" rel="noopener noreferrer">
            <Cloud />
            Open the whole game in Google Drive
          </a>
        </Button>
      )}

      {/* CR-003: the whole game, one video per camera (once it's made) */}
      {!saving && videos.length > 1 && (
        <CameraTabs videos={videos} active={activeVideo} onSelect={setCameraTab} />
      )}
      {!saving && activeVideo && <WholeVideoCard video={activeVideo} twoCameras={twoCameras} />}

      {/* Only a game recorded before whole videos still lists its pieces */}
      {parts.length > 0 && (
        <div className="mt-4 space-y-3">
          {parts.map((part) => (
            <PartCard key={`${part.partIndex}-${part.camera ?? 0}`} part={part} />
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
