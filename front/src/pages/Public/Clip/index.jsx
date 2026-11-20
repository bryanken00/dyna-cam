import {
  Cloud,
  Download,
  Film,
  Loader2,
  Lock,
  RotateCcw,
  Share2,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useClipPageHooks } from "./hooks";
import PublicLayout from "../../../components/layout/PublicLayout";
import ResultState from "../../../components/ResultState";
import Spinner from "../../../components/Spinner";
import { getImageUrl } from "../../../utils/upload";
import PayCode from "../../../components/PayCode";
import { formatDateTime, formatPeso } from "../../../utils/dynaCam";

const cardStyle = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-line)",
  borderRadius: "var(--radius-card)",
};

/** CR-001: the copy in the venue's Google Drive (opens without a Google sign-in). */
const DriveButton = ({ href, className = "" }) => (
  <Button asChild variant="outline" size="lg" className={`h-12 ${className}`}>
    <a href={href} target="_blank" rel="noopener noreferrer">
      <Cloud />
      Open in Google Drive
    </a>
  </Button>
);

/** Venue logo + venue/court line shown above every state. */
const ClipHeading = ({ clip, courtName, venueName }) => {
  const logo = getImageUrl(clip?.venueLogoUrl);
  return (
    <div className="flex items-center gap-3 mb-4 min-w-0">
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
          style={{ fontSize: 20, letterSpacing: "-0.3px", color: "var(--color-text-dark)" }}
        >
          {courtName}
        </h1>
        <p
          className="m-0 truncate"
          style={{ fontSize: 13, color: "var(--color-text-secondary)" }}
        >
          {venueName}
          {clip?.requestedAt && ` · ${formatDateTime(clip.requestedAt)}`}
        </p>
      </div>
    </div>
  );
};

/**
 * A Ready clip that isn't paid yet: the thumbnail under a lock, the price and
 * the pay code. The page keeps polling, so it unlocks by itself once staff
 * record the cash.
 */
const LockedClip = ({ clip }) => {
  const thumb = getImageUrl(clip.thumbnailUrl);
  return (
    <div className="overflow-hidden" style={cardStyle}>
      <div
        className="relative w-full flex items-center justify-center"
        style={{ aspectRatio: "16 / 9", background: "var(--color-surface-sunken)" }}
      >
        {thumb ? (
          <img src={thumb} alt="" className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <Film className="w-8 h-8" style={{ color: "var(--color-text-muted)" }} />
        )}
        {/* Dim the preview so the lock reads as the message */}
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{ background: "color-mix(in srgb, var(--color-canvas) 55%, transparent)" }}
        />
        <span
          className="relative inline-flex items-center justify-center"
          style={{
            width: 56,
            height: 56,
            borderRadius: 999,
            background: "var(--color-surface)",
            border: "1px solid var(--color-line)",
            color: "var(--color-text-dark)",
          }}
        >
          <Lock className="w-6 h-6" />
        </span>
      </div>

      <div className="p-5 text-center" aria-live="polite">
        <p
          className="m-0 font-semibold"
          style={{ fontSize: 17, color: "var(--color-text-dark)" }}
        >
          Pay {formatPeso(clip.price)} at the front desk to unlock this clip
        </p>
        <div
          className="mt-4 py-4 px-3"
          style={{
            border: "1px dashed var(--color-line)",
            borderRadius: 12,
            background: "var(--color-surface-sunken)",
          }}
        >
          <PayCode code={clip.payCode} />
          <p
            className="m-0 mt-1.5"
            style={{ fontSize: 13, color: "var(--color-text-secondary)" }}
          >
            Show this code to the staff
          </p>
        </div>
        <p
          className="m-0 mt-3 inline-flex items-center gap-1.5"
          style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}
        >
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          This page unlocks by itself once you&apos;ve paid.
        </p>
      </div>
    </div>
  );
};

/**
 * `/clip/:shareToken` — the player's replay. Polls while the clip is being
 * saved, then shows the video with Download and Share.
 */
const ClipPage = () => {
  const {
    clip,
    courtName,
    venueName,
    merged,
    isLoading,
    isFetching,
    notFound,
    loadError,
    refetch,
    progress,
    handleShare,
  } = useClipPageHooks();

  if (isLoading) {
    return (
      <PublicLayout>
        <Spinner className="py-24" tip="Loading your clip…" />
      </PublicLayout>
    );
  }

  if (notFound) {
    return (
      <PublicLayout>
        <ResultState
          status="404"
          title="This clip link isn't valid"
          description="It may have been typed wrong, or the clip was removed."
        />
      </PublicLayout>
    );
  }

  if (loadError || !clip) {
    return (
      <PublicLayout>
        <ResultState
          status="error"
          title="Couldn't load this clip"
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

  const heading = (
    <ClipHeading clip={clip} courtName={courtName} venueName={venueName} />
  );

  if (clip.status === "Failed") {
    return (
      <PublicLayout>
        {heading}
        <div style={cardStyle}>
          <ResultState
            status="error"
            title="We couldn't save this clip"
            description="Something went wrong with the court's recorder. Scan the court's QR code again to save your next rally."
          />
        </div>
      </PublicLayout>
    );
  }

  if (clip.status === "Expired") {
    return (
      <PublicLayout>
        {heading}
        <div style={cardStyle}>
          <ResultState
            status="404"
            title="This clip has been deleted"
            description="Clips are only kept for a short time after they're saved."
          />
        </div>
      </PublicLayout>
    );
  }

  const mergedNotice = merged && (
    <div
      role="status"
      className="flex items-start gap-2.5 mb-4 px-3.5 py-3"
      style={{ ...cardStyle, borderRadius: 10, fontSize: 13.5, color: "var(--color-text-dark)" }}
    >
      <Sparkles
        className="w-4 h-4 mt-0.5 shrink-0"
        style={{ color: "var(--color-secondary-color)" }}
      />
      <span>Someone just saved this moment — here&apos;s the clip.</span>
    </div>
  );

  if (clip.status === "Pending") {
    return (
      <PublicLayout>
        {heading}
        {mergedNotice}
        <div className="p-6 text-center" style={cardStyle} aria-live="polite">
          <Loader2
            className="mx-auto animate-spin"
            style={{ width: 32, height: 32, color: "var(--color-secondary-color)" }}
          />
          <p
            className="m-0 mt-4 font-semibold"
            style={{ fontSize: 17, color: "var(--color-text-dark)" }}
          >
            Saving your clip…
          </p>
          <p
            className="m-0 mt-1"
            style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}
          >
            This takes about a minute. Keep this page open — the video appears
            here on its own.
          </p>
          <div
            className="mt-5 overflow-hidden"
            role="progressbar"
            aria-label="Saving your clip"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
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
                width: `${progress}%`,
                borderRadius: 999,
                background: "var(--color-secondary-color)",
              }}
            />
          </div>
          {clip.locked && clip.payCode && (
            <div
              className="mt-5 pt-4"
              style={{ borderTop: "1px solid var(--color-line)" }}
            >
              <p
                className="m-0"
                style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}
              >
                This clip costs {formatPeso(clip.price)} — pay at the front desk
                with this code:
              </p>
              <div className="mt-2">
                <PayCode code={clip.payCode} size={26} />
              </div>
            </div>
          )}
        </div>
      </PublicLayout>
    );
  }

  if (clip.locked) {
    return (
      <PublicLayout>
        {heading}
        {mergedNotice}
        <LockedClip clip={clip} />
      </PublicLayout>
    );
  }

  // Ready
  const videoSrc = getImageUrl(clip.videoUrl);
  // Signed `&download=1` link — the server answers it as an attachment
  // (dyna-cam-replay.mp4), so it saves even when the API is on another origin
  const downloadHref = getImageUrl(clip.downloadUrl);
  return (
    <PublicLayout>
      {heading}
      {mergedNotice}
      <div className="overflow-hidden" style={cardStyle}>
        {videoSrc ? (
          <video
            key={videoSrc}
            src={videoSrc}
            poster={getImageUrl(clip.thumbnailUrl) || undefined}
            controls
            playsInline
            preload="metadata"
            className="w-full block"
            style={{ aspectRatio: "16 / 9", background: "var(--color-surface-sunken)" }}
          />
        ) : (
          <div
            className="w-full flex items-center justify-center"
            style={{
              aspectRatio: "16 / 9",
              background: "var(--color-surface-sunken)",
              color: "var(--color-text-muted)",
              fontSize: 13.5,
            }}
          >
            The video isn&apos;t available.
          </div>
        )}

        <div className="p-4 grid grid-cols-2 gap-3">
          {downloadHref ? (
            <Button asChild variant="outline" size="lg" className="h-12">
              <a href={downloadHref} download>
                <Download />
                Download
              </a>
            </Button>
          ) : (
            <Button variant="outline" size="lg" className="h-12" disabled>
              <Download />
              Download
            </Button>
          )}
          <Button size="lg" className="h-12" onClick={handleShare}>
            <Share2 />
            Share
          </Button>
          {clip.driveUrl && <DriveButton href={clip.driveUrl} className="col-span-2" />}
        </div>
      </div>

      {clip.expiresAt && (
        <p
          className="m-0 mt-3 text-center"
          style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}
        >
          Available until {formatDateTime(clip.expiresAt)}
        </p>
      )}
    </PublicLayout>
  );
};

export default ClipPage;
