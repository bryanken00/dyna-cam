import {
  CalendarClock,
  CircleAlert,
  Cloud,
  Lock,
  Video,
  Loader2,
  Play,
  Radio,
  RotateCcw,
  Share2,
  Square,
  Trash2,
} from "lucide-react";
import dayjs from "dayjs";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { useSessionPageHooks } from "./hooks";
import DriveVideo from "./components/DriveVideo";
import LivePanel from "./components/LivePanel";
import SaveStretch from "./components/SaveStretch";
import PublicLayout from "../../../components/layout/PublicLayout";
import PayCode from "../../../components/PayCode";
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
        <CalendarClock
          className="w-4 h-4 mt-0.5 shrink-0"
          style={{ color: "var(--color-text-muted)" }}
        />
        <span>
          <strong className="font-semibold">Not started yet</strong> — recording
          starts when the court&apos;s device is set up. Keep this link: your
          whole game appears here as one video after it ends.
        </span>
      </div>
    );
  }
  if (status === "Scheduled") {
    return (
      <div className="flex items-start gap-2.5 px-3.5 py-3" style={noticeStyle}>
        <CalendarClock
          className="w-4 h-4 mt-0.5 shrink-0"
          style={{ color: "var(--color-text-muted)" }}
        />
        <span>
          <strong className="font-semibold">
            Recording starts at {dayjs(session.startAt).format("h:mm A")}
          </strong>
          {!dayjs(session.startAt).isSame(dayjs(), "day") &&
            ` on ${formatDate(session.startAt)}`}
          . Keep this link — your whole game appears here as one video after it
          ends.
        </span>
      </div>
    );
  }
  if (status === "Recording") {
    // CR-025: the live view and Save the last … sit under this
    return (
      <div className="flex items-start gap-2.5 px-3.5 py-3" style={noticeStyle}>
        <Radio
          className="w-4 h-4 mt-0.5 shrink-0"
          style={{ color: "var(--color-error)" }}
        />
        <span>
          <strong className="font-semibold">Recording now</strong> — watch it
          live below on the venue Wi-Fi. Your whole game appears here as one
          video when it ends.
        </span>
      </div>
    );
  }
  if (status === "Failed") {
    return (
      <div className="flex items-start gap-2.5 px-3.5 py-3" style={noticeStyle}>
        <CircleAlert
          className="w-4 h-4 mt-0.5 shrink-0"
          style={{ color: "var(--color-error)" }}
        />
        <span>
          <strong className="font-semibold">
            This game couldn&apos;t be recorded.
          </strong>{" "}
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
    <div
      className="p-4"
      style={{ ...cardStyle, borderRadius: 10 }}
      aria-live="polite"
    >
      <div
        className="flex items-center gap-2"
        style={{ fontSize: 14.5, color: "var(--color-text-dark)" }}
      >
        <Loader2
          className="w-4 h-4 shrink-0 animate-spin"
          style={{ color: "var(--color-secondary-color)" }}
        />
        <span className="font-semibold">
          {known ? `Saving your game… sending to Google Drive ${percent}%` : "Saving your game…"}
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
      <p
        className="m-0 mt-2"
        style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}
      >
        The venue&apos;s recorder sends your game to Google Drive — a long game can take a
        while. This page updates on its own — keep it open or come back to this link later.
      </p>
    </div>
  );
};

/**
 * CR-041: a booked game ended early — record the rest of the booked time as a
 * new game, or (once that happened) a link to it.
 */
const ResumeCard = ({ resume, continuedPath, onResume, resuming }) => {
  const until = dayjs(resume.until).format("h:mm A");
  return (
    <div className="p-4 mt-4" style={cardStyle}>
      {continuedPath ? (
        <>
          <p className="m-0" style={{ fontSize: 14, color: "var(--color-text-dark)" }}>
            <strong className="font-semibold">The recording continues in a new game</strong>{" "}
            until {until}.
          </p>
          <Button asChild variant="outline" size="lg" className="h-12 w-full mt-3">
            <Link to={continuedPath}>
              <Play />
              Open the new game
            </Link>
          </Button>
        </>
      ) : (
        <>
          <p className="m-0" style={{ fontSize: 14, color: "var(--color-text-dark)" }}>
            <strong className="font-semibold">Ended early?</strong> Your booking runs until{" "}
            {until}.
          </p>
          <Button size="lg" className="h-12 w-full mt-3" onClick={onResume} disabled={resuming}>
            {resuming ? <Loader2 className="animate-spin" /> : <Play />}
            Resume recording
          </Button>
          <p className="m-0 mt-2" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
            It records the rest of your booking as a new game. This game&apos;s video stays
            here.
          </p>
        </>
      )}
    </div>
  );
};

/** "8 minutes weren't recorded (11:23 – 11:31 AM)" for a whole video's gaps. */
const gapNote = (gaps) => {
  const seconds = gaps.reduce(
    (sum, gap) => sum + dayjs(gap.endAt).diff(dayjs(gap.startAt), "second"),
    0,
  );
  const minutes = Math.max(1, Math.round(seconds / 60));
  const what =
    minutes === 1
      ? "1 minute wasn't recorded"
      : `${minutes} minutes weren't recorded`;
  return `${what} (${gaps.map((gap) => formatTimeRange(gap.startAt, gap.endAt)).join(", ")})`;
};

/** CR-003: Cam 1 / Cam 2 switch above the whole video (two-camera courts). */
const CameraTabs = ({ videos, active, onSelect }) => (
  <div
    className="grid grid-cols-2 gap-2 mt-4"
    role="tablist"
    aria-label="Camera"
  >
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
 * CR-003: the whole game as one video (per camera) — the stretches the camera
 * missed, and (CR-040) its Google Drive link: players get videos only there.
 */
const WholeVideoCard = ({ video, twoCameras }) => {
  const title = twoCameras ? `${video.label} — whole game` : "Whole game";
  const muted = { fontSize: 13, color: "var(--color-text-secondary)" };

  return (
    <div className="overflow-hidden mt-3" style={cardStyle}>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <span
          className="font-semibold"
          style={{ fontSize: 14.5, color: "var(--color-text-dark)" }}
        >
          {title}
        </span>
        {video.status === "Ready" && (
          <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
            {[
              video.durationSeconds
                ? formatMinutes(Math.round(video.durationSeconds / 60))
                : null,
              video.sizeBytes ? formatBytes(video.sizeBytes) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        )}
      </div>

      <DriveVideo
        video={video}
        qr
        label={twoCameras ? `Open ${video.label} in Google Drive` : "Open in Google Drive"}
      />

      {video.gaps?.length > 0 && video.status === "Ready" && (
        <p className="m-0 px-4 pb-3" style={muted}>
          {gapNote(video.gaps)} — the camera wasn&apos;t recording then, so the
          video skips it.
        </p>
      )}
      {video.status === "Failed" && (
        <p className="m-0 px-4 pb-3" style={muted}>
          We&apos;re still putting your video together — check back soon.
        </p>
      )}
      {/* CR-017: gone from here and from the venue's Google Drive */}
      {video.status === "Expired" && (
        <p className="m-0 px-4 pb-3" style={muted}>
          This video has been deleted — videos are only kept for a short time after the game.
        </p>
      )}
    </div>
  );
};

/** 125 → "2:05" — a point in the game. */
const clockOf = (seconds) =>
  `${Math.floor(seconds / 60)}:${String(Math.max(0, seconds) % 60).padStart(2, "0")}`;

/**
 * CR-013: a stretch saved from the courtside device — "Save 1 · 8:00 – 10:00",
 * then its video (one per camera on a two-camera court) once it's in.
 * CR-028: with a delete button, as on the device.
 */
const CaptureCard = ({ capture, onDelete, deleting }) => {
  const muted = { fontSize: 13, color: "var(--color-text-secondary)" };

  return (
    <div className="overflow-hidden" style={cardStyle}>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <span
          className="font-semibold"
          style={{ fontSize: 14.5, color: "var(--color-text-dark)" }}
        >
          Save {capture.number} · {clockOf(capture.fromSeconds)} –{" "}
          {clockOf(capture.toSeconds)}
        </span>
        <StatusDot
          tone={
            capture.status === "Ready"
              ? "success"
              : ["Saving", "Queued"].includes(capture.status)
                ? "warning"
                : "muted"
          }
        >
          {capture.status === "Queued"
            ? "In queue"
            : capture.status === "Saving" && capture.uploadPercent >= 99
              ? "Finishing…"
              : capture.status === "Saving" && capture.uploadPercent != null
                ? `Saving ${capture.uploadPercent}%`
                : capture.status}
        </StatusDot>
        {onDelete && (
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 -mr-2"
            onClick={() => onDelete(capture)}
            disabled={deleting}
            aria-label={`Delete Save ${capture.number}`}
          >
            {deleting ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Trash2 style={{ color: "var(--color-text-muted)" }} />
            )}
          </Button>
        )}
      </div>

      {/* CR-040: a save is only a Google Drive link, like the whole game */}
      {capture.videos.map((video) => (
        <div key={video.camera}>
          {capture.videos.length > 1 && video.status === "Ready" && (
            <p className="m-0 px-4" style={muted}>
              {video.label}
            </p>
          )}
          <DriveVideo video={video} />
        </div>
      ))}

      {capture.status === "Saving" && (
        <p className="m-0 px-4 pb-3" style={muted}>
          The venue&apos;s recorder is sending this part of your game to Google Drive — its
          link appears here when it&apos;s there.
        </p>
      )}
      {capture.status === "Queued" && (
        <p className="m-0 px-4 pb-3" style={muted}>
          Waiting for the save before it to finish — the recorder makes them one
          at a time.
        </p>
      )}
      {capture.status === "Failed" && (
        <p className="m-0 px-4 pb-3" style={muted}>
          This save couldn&apos;t be made — the camera may not have been
          recording then.
        </p>
      )}
      {capture.status === "Expired" && (
        <p className="m-0 px-4 pb-3" style={muted}>
          This save has been deleted — videos are only kept for a short time after the game.
        </p>
      )}
    </div>
  );
};

/**
 * `/session/:shareToken` — a recorded game for the player: when it starts, that
 * it's recording, how much is saved after it ends, then the whole video per
 * camera (CR-003), each a Google Drive link (CR-040). Polls while anything changes.
 */
/**
 * CR-015: a game that isn't paid yet — the code to show at the front desk and
 * what's waiting. Nothing plays until staff record the payment; the page keeps
 * checking, so it opens by itself.
 */
const LockedGame = ({ session, videos, captures }) => {
  const waiting = [
    videos.length > 0 || ["Processing", "Ready"].includes(session.status)
      ? "the whole game"
      : null,
    captures.length > 0
      ? `${captures.length} ${captures.length === 1 ? "save" : "saves"}`
      : null,
  ].filter(Boolean);
  return (
    <div className="mt-4 p-5 text-center" style={cardStyle} aria-live="polite">
      <span
        className="inline-flex items-center justify-center"
        style={{
          width: 52,
          height: 52,
          borderRadius: 999,
          background: "var(--color-surface-sunken)",
          border: "1px solid var(--color-line)",
          color: "var(--color-text-dark)",
        }}
      >
        <Lock className="w-5.5 h-5.5" />
      </span>
      <p
        className="m-0 mt-3 font-semibold"
        style={{ fontSize: 17, color: "var(--color-text-dark)" }}
      >
        Pay at the front desk to get your videos
      </p>
      {waiting.length > 0 && (
        <p
          className="m-0 mt-1"
          style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}
        >
          Waiting for you: {waiting.join(" and ")}
        </p>
      )}
      <div
        className="mt-4 py-4 px-3"
        style={{
          border: "1px dashed var(--color-line)",
          borderRadius: 12,
          background: "var(--color-surface-sunken)",
        }}
      >
        <PayCode code={session.payCode} />
        <p
          className="m-0 mt-1.5"
          style={{ fontSize: 13, color: "var(--color-text-secondary)" }}
        >
          Show this code to the staff
        </p>
      </div>
      <p
        className="m-0 mt-3"
        style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}
      >
        This page opens by itself once it&apos;s paid.
      </p>
    </div>
  );
};

/** "YouTube", "Facebook" or "your stream" for the player's stream. */
const STREAM_NAME = { YOUTUBE: "YouTube", FACEBOOK: "Facebook" };
const STREAM_STATE = {
  live: "live now",
  starting: "starting…",
  waiting: "starts with the game",
  error: "not reaching the platform",
};

/**
 * CR-028: the player's own Facebook / YouTube stream, as on the court device —
 * add it (the stream setup page), or change / stop the one set.
 */
const StreamBlock = ({ stream, onOpen, opening, onStop, stopping }) => {
  if (!stream) {
    return (
      <Button
        variant="outline"
        size="lg"
        className="h-12 w-full mt-4"
        onClick={onOpen}
        disabled={opening}
      >
        {opening ? <Loader2 className="animate-spin" /> : <Radio />}
        Stream to your Facebook / YouTube
      </Button>
    );
  }
  return (
    <div className="mt-4 p-4" style={cardStyle}>
      <div className="flex items-center gap-2" style={{ fontSize: 14 }}>
        <Radio
          className="w-4 h-4 shrink-0"
          style={{
            color: stream.status === "live" ? "var(--color-error)" : "var(--color-text-muted)",
          }}
        />
        <span style={{ color: "var(--color-text-dark)" }}>
          <span className="font-semibold">
            Streaming to {STREAM_NAME[stream.platform] || "your stream"}
          </span>{" "}
          · {STREAM_STATE[stream.status] || stream.status}
        </span>
      </div>
      {stream.message && (
        <p className="m-0 mt-1.5" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
          {stream.message}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 mt-3">
        <Button variant="outline" className="h-11" onClick={onOpen} disabled={opening}>
          {opening && <Loader2 className="animate-spin" />}
          Change stream
        </Button>
        <Button variant="outline" className="h-11" onClick={onStop} disabled={stopping}>
          {stopping ? (
            <Loader2 className="animate-spin" />
          ) : (
            <span style={{ color: "var(--color-error)" }}>Stop streaming</span>
          )}
        </Button>
      </div>
    </div>
  );
};

// CR-035: a wide screen's column — its first part needs no top gap
const columnClass = "min-w-0 [&>*:first-child]:mt-0";

const SessionPage = () => {
  const {
    session,
    live,
    capture,
    isRecording,
    since,
    saveCapture,
    previewStretch,
    stream,
    canStream,
    handleEndGame,
    isEnding,
    resume,
    continuedPath,
    handleResume,
    isResuming,
    handleDeleteCapture,
    deletingNumber,
    handleOpenStream,
    isOpeningStream,
    handleStopStream,
    isStoppingStream,
    videos,
    captures,
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
    wide,
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

  // CR-025: what the court device shows while recording — paid or not.
  // CR-028: with the device's other controls — the player's own stream and
  // End game. CR-035: built once, placed by screen width in the return.
  const liveBlock = isRecording && <LivePanel live={live} />;
  const saveBlock = isRecording && (
    <SaveStretch capture={capture} since={since} save={saveCapture} preview={previewStretch} />
  );
  const endBlock = isRecording && (
    <Button
      variant="destructive"
      size="lg"
      className="h-16 w-full mt-4 text-lg font-bold rounded-(--radius-card)"
      onClick={handleEndGame}
      disabled={isEnding}
    >
      {isEnding ? <Loader2 className="size-5 animate-spin" /> : <Square className="size-5" fill="currentColor" />}
      End game
    </Button>
  );
  // CR-041: the rest of the booked time, after an early End game
  const resumeBlock = resume && (
    <ResumeCard
      resume={resume}
      continuedPath={continuedPath}
      onResume={handleResume}
      resuming={isResuming}
    />
  );
  // Secondary, below End game — as on the device
  const streamBlock = canStream && (
    <StreamBlock
      stream={stream}
      onOpen={handleOpenStream}
      opening={isOpeningStream}
      onStop={handleStopStream}
      stopping={isStoppingStream}
    />
  );
  const lockedBlock = session.locked && (
    <LockedGame session={session} videos={videos} captures={captures} />
  );
  // CR-001: the whole game's folder in the venue's Google Drive
  const driveBlock = !session.locked && session.driveUrl && (
    <Button asChild variant="outline" size="lg" className="h-12 w-full mt-4">
      <a href={session.driveUrl} target="_blank" rel="noopener noreferrer">
        <Cloud />
        Open the whole game in Google Drive
      </a>
    </Button>
  );
  // CR-003: the whole game, one video per camera (once it's made)
  const videoBlock = !session.locked && !saving && activeVideo && (
    <>
      {videos.length > 1 && <CameraTabs videos={videos} active={activeVideo} onSelect={setCameraTab} />}
      <WholeVideoCard video={activeVideo} twoCameras={twoCameras} />
    </>
  );
  // CR-013: the stretches saved from the courtside device
  // CR-037: on a wide screen, a grid under the video (two per row); phones keep the list
  const savesBlock = !session.locked && captures.length > 0 && (
    <div className="mt-6">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="m-0 font-semibold" style={{ fontSize: 15.5, color: "var(--color-text-dark)" }}>
          Your saves
        </h2>
        <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
          {capture?.maxPerGame
            ? `${captures.length} of ${capture.maxPerGame}`
            : `${captures.length} ${captures.length === 1 ? "save" : "saves"}`}
        </span>
      </div>
      <div className={wide ? "grid grid-cols-2 gap-3 items-start" : "space-y-3"}>
        {captures.map((capture) => (
          <CaptureCard
            key={`${capture.number}-${capture.savedAt}`}
            capture={capture}
            onDelete={handleDeleteCapture}
            deleting={deletingNumber === capture.number}
          />
        ))}
      </div>
    </div>
  );
  const shareBlock = !session.locked && readyCount > 0 && (
    <div className="mt-4">
      <Button size="lg" className="h-12 w-full" onClick={handleShare}>
        <Share2 />
        Share this session
      </Button>
      {expiresAt && (
        <p className="m-0 mt-3 text-center" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
          On Google Drive until {formatDateTime(expiresAt)} — save a copy before then. It&apos;s
          removed after that.
        </p>
      )}
    </div>
  );

  return (
    <PublicLayout wide={wide}>
      {/* Heading */}
      <div className="flex items-center gap-3 mb-1 min-w-0">
        {logo && (
          <img
            src={logo}
            alt=""
            className="object-contain shrink-0"
            style={{ maxHeight: 40, maxWidth: 96 }}
          />
        )}
        <div className="min-w-0">
          <h1
            className="m-0 font-semibold leading-tight truncate"
            style={{
              fontSize: 20,
              letterSpacing: "-0.3px",
              color: "var(--color-text-dark)",
            }}
          >
            {courtName}
          </h1>
          <p
            className="m-0 truncate"
            style={{ fontSize: 13, color: "var(--color-text-secondary)" }}
          >
            {venueName}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 flex-wrap mt-3 mb-4">
        <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
          {playerName && (
            <div
              className="font-medium"
              style={{ color: "var(--color-text-dark)" }}
            >
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
        <StatusDot
          tone={
            saving ? "warning" : SESSION_STATUS_TONE[session.status] || "muted"
          }
        >
          {saving ? "Saving" : session.status}
        </StatusDot>
      </div>

      <StatusNotice session={session} />
      {saving && <SavingProgress percent={saving.percent} />}

      {/* CR-035: each part built once below; phones keep today's order,
          wide screens put the video (CR-037: and the saves, as a grid) on the
          left and the game's controls on the right */}
      {wide && (liveBlock || lockedBlock || videoBlock || savesBlock) ? (
        <div className="mt-4 grid gap-6 grid-cols-[minmax(0,1fr)_380px] items-start">
          <div className={columnClass}>
            {liveBlock}
            {lockedBlock}
            {videoBlock}
            {savesBlock}
          </div>
          <div className={columnClass}>
            {saveBlock}
            {endBlock}
            {resumeBlock}
            {streamBlock}
            {driveBlock}
            {shareBlock}
          </div>
        </div>
      ) : (
        // Phones — and a wide screen with nothing for the left yet (no live
        // view, no video): one column, kept phone-width
        <div className={wide ? "max-w-md" : undefined}>
          {liveBlock}
          {saveBlock}
          {endBlock}
          {resumeBlock}
          {streamBlock}
          {lockedBlock}
          {driveBlock}
          {videoBlock}
          {savesBlock}
          {shareBlock}
        </div>
      )}
    </PublicLayout>
  );
};

export default SessionPage;
