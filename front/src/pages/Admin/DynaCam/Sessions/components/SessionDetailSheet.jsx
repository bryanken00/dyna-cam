import { useState } from "react";
import {
  Ban,
  Banknote,
  Cloud,
  Copy,
  Download,
  Film,
  RotateCcw,
  Square,
  X,
} from "lucide-react";
import { toast } from "sonner";
import dayjs from "dayjs";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import GamePaymentFormModal from "./GamePaymentFormModal";
import SessionDevices from "./SessionDevices";
import SessionStreamLine from "./SessionStreamLine";
import DescriptionList from "../../../../../components/DescriptionList";
import PaymentStatusChip from "../../../../../components/PaymentStatusChip";
import Spinner from "../../../../../components/Spinner";
import StatusDot from "../../../../../components/StatusDot";
import { usePermissions } from "../../../../../hooks/usePermissions";
import { confirm } from "../../../../../store/confirmStore";
import { copyText } from "../../../../../utils/clipboard";
import { decodeHTML } from "../../../../../utils/decode-html";
import { formatPhoneDisplay } from "../../../../../utils/phoneFormat";
import { getImageUrl } from "../../../../../utils/upload";
import {
  CLIP_STATUS_TONE,
  SESSION_STATUS_TONE,
  formatBytes,
  formatDate,
  formatMinutes,
  formatPayCode,
  formatTimeRange,
} from "../../../../../utils/dynaCam";
import {
  useCancelSession,
  useEndSession,
  useGetSessionById,
  useRetrySessionVideo,
} from "../../../../../services/requests/admin/sessions";

/** CR-003 / CR-006: whole-video status → StatusDot tone. */
const VIDEO_STATUS_TONE = {
  Pending: "warning",
  Uploading: "warning",
  Joining: "warning",
  Ready: "success",
  Failed: "error",
  Expired: "muted",
};

/**
 * CR-003: one camera's whole-game video — what the player downloads — with
 * its status, the stretches it skips, and Try again when joining failed.
 */
/** 125 → "2:05" — a point in the game (CR-013 saves). */
const clockOf = (seconds) =>
  `${Math.floor(seconds / 60)}:${String(Math.max(0, seconds) % 60).padStart(2, "0")}`;

const WholeVideoRow = ({ video, sessionId, canWrite }) => {
  const retryMutation = useRetrySessionVideo();
  const ready = video.status === "Ready";
  const videoSrc = getImageUrl(video.videoUrl);
  const downloadHref = getImageUrl(video.downloadUrl);
  const muted = { fontSize: 12, color: "var(--color-text-muted)" };
  return (
    <div className="p-3.5" style={{ borderTop: "1px solid var(--color-line)" }}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <span
            className="font-semibold"
            style={{ fontSize: 13.5, color: "var(--color-text-dark)" }}
          >
            {video.label}
          </span>
          {ready && (
            <span style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
              {" · "}
              {formatMinutes(Math.round((video.durationSeconds || 0) / 60))}
              {video.sizeBytes ? ` · ${formatBytes(video.sizeBytes)}` : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <StatusDot
            tone={VIDEO_STATUS_TONE[video.status] || "muted"}
            title={video.failureReason || undefined}
          >
            {/* CR-006: the recorder box makes the file, then uploads it */}
            {video.status === "Pending"
              ? "Being made on the box"
              : video.status === "Uploading"
                ? `Uploading ${video.uploadPercent ?? 0}%`
                : video.status}
          </StatusDot>
          {ready && downloadHref && (
            <Button asChild variant="outline" size="sm">
              <a href={downloadHref} download>
                <Download />
                Download
              </a>
            </Button>
          )}
          {video.driveUrl && (
            <Button
              asChild
              variant="ghost"
              size="sm"
              title="Open in Google Drive"
            >
              <a
                href={video.driveUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Cloud />
              </a>
            </Button>
          )}
          {video.status === "Failed" && canWrite && (
            <Button
              variant="outline"
              size="sm"
              disabled={retryMutation.isPending}
              onClick={() =>
                retryMutation.mutate({ sessionId, camera: video.camera })
              }
            >
              <RotateCcw />
              Try again
            </Button>
          )}
        </div>
      </div>
      {video.status === "Failed" && video.failureReason && (
        <p className="m-0 mt-1" style={muted}>
          {video.failureReason}. Try again asks the recorder box to send it
          again — it works while the box still has the game&apos;s footage.
        </p>
      )}
      {video.gaps?.length > 0 && (
        <p className="m-0 mt-1" style={muted}>
          Skips{" "}
          {video.gaps
            .map((gap) => formatTimeRange(gap.startAt, gap.endAt))
            .join(", ")}{" "}
          (no footage)
        </p>
      )}
      {ready && videoSrc && (
        <video
          key={videoSrc}
          src={videoSrc}
          poster={getImageUrl(video.thumbnailUrl) || undefined}
          controls
          playsInline
          preload="none"
          className="w-full block mt-3"
          style={{
            aspectRatio: "16 / 9",
            borderRadius: 10,
            border: "1px solid var(--color-line)",
            background: "var(--color-surface-sunken)",
          }}
        />
      )}
    </div>
  );
};

/**
 * Session detail: its devices (pair / unpair, live keys) and its whole video per camera —
 * refreshes while the session is live. Not a form — takes the session id,
 * the write flag, and `onPairDevice(session)` (the page owns the pairing
 * dialogs so a booking can open them too).
 */
const SessionDetailSheet = ({
  open,
  onClose,
  sessionId,
  canWrite,
  onPairDevice,
}) => {
  const { data, isLoading, error } = useGetSessionById(open ? sessionId : null);
  const session = data?.data?.session || null;
  const videos = session?.videos || [];
  // CR-013: stretches saved from the courtside device
  const captures = session?.captures || [];
  // While it can take a device, or while one is still paired (the device
  // keeps the download QR for a few minutes after the end)
  const showDevices =
    ["Waiting", "Scheduled", "Recording"].includes(session?.status) ||
    (session?.devices || []).some((d) => d.status === "Active");
  const showStream =
    !!session?.stream ||
    ["Waiting", "Scheduled", "Recording"].includes(session?.status);

  const cancelMutation = useCancelSession();
  const endMutation = useEndSession();

  // CR-015: the game's videos open once its payment is recorded here (Payments permission)
  const { hasPermission } = usePermissions();
  const [payOpen, setPayOpen] = useState(false);
  const canTakePayment =
    hasPermission("payments", null, "write") &&
    session?.paymentStatus === "Unpaid" &&
    !["Cancelled", "Failed"].includes(session?.status);

  const handleCopy = async () => {
    const ok = await copyText(session?.shareUrl);
    if (ok) toast.success("Player link copied");
    else toast.error("Couldn't copy the link");
  };

  const handleEnd = async () => {
    const ok = await confirm({
      title: "End game",
      description:
        "Stop recording now? The footage so far is still saved and sent to the player link.",
      confirmText: "End game",
      cancelText: "Keep recording",
      danger: true,
    });
    if (ok) endMutation.mutate(sessionId);
  };

  const handleCancel = async () => {
    const ok = await confirm({
      title: "Cancel session",
      description:
        "Cancel this session? Nothing will be recorded and its player link stops working.",
      confirmText: "Cancel session",
      cancelText: "Keep it",
      danger: true,
    });
    if (ok) cancelMutation.mutate(sessionId);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full gap-0 p-0 sm:max-w-200"
        style={{ background: "var(--color-surface)" }}
      >
        <div className="flex h-full flex-col">
          <div className="flex-1 overflow-y-auto p-6">
            {/* Header */}
            <div className="flex items-start justify-between gap-3 mb-6">
              <div className="flex items-center gap-3 min-w-0">
                <span className="inline-flex items-center justify-center w-11 h-11 rounded-xl shrink-0 bg-(image:--gradient-primary)">
                  <Film className="w-5.5 h-5.5 text-white" />
                </span>
                <div className="min-w-0">
                  <SheetTitle
                    className="m-0 font-semibold leading-tight truncate"
                    style={{ fontSize: 19, color: "var(--color-text-dark)" }}
                  >
                    {session ? decodeHTML(session.courtName) : "Session"}
                  </SheetTitle>
                  <SheetDescription
                    className="m-0 mt-0.5 truncate"
                    style={{
                      fontSize: 13,
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    {!session
                      ? "Loading…"
                      : session.status === "Waiting"
                        ? `${decodeHTML(session.venueName)} · waiting for a device`
                        : !session.endAt
                          ? `${decodeHTML(session.venueName)} · ${formatDate(session.startAt)}, recording since ${dayjs(session.startAt).format("h:mm A")}`
                          : `${decodeHTML(session.venueName)} · ${formatDate(
                              session.startAt,
                            )}, ${formatTimeRange(session.startAt, session.endAt)}`}
                  </SheetDescription>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="inline-flex items-center justify-center shrink-0 transition-colors hover:bg-(--color-surface-sunken)"
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  border: "1px solid var(--color-line)",
                  color: "var(--color-text-secondary)",
                }}
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            {isLoading && <Spinner className="py-16" tip="Loading session…" />}
            {error && (
              <p
                style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}
              >
                {error.response?.data?.message || "Couldn't load this session."}
              </p>
            )}

            {session && (
              <>
                <DescriptionList
                  items={[
                    {
                      label: "Status",
                      value: (
                        <div>
                          <StatusDot
                            tone={
                              SESSION_STATUS_TONE[session.status] || "muted"
                            }
                          >
                            {session.status}
                          </StatusDot>
                          {session.failureReason && (
                            <div
                              style={{
                                fontSize: 12,
                                color: "var(--color-text-muted)",
                              }}
                            >
                              {session.failureReason}
                            </div>
                          )}
                        </div>
                      ),
                    },
                    {
                      label: "Payment",
                      value: (
                        <div>
                          <PaymentStatusChip
                            paymentStatus={session.paymentStatus}
                            price={session.paidAmount}
                          />
                          <div
                            style={{
                              fontSize: 12,
                              color: "var(--color-text-muted)",
                            }}
                          >
                            {session.paymentStatus === "Unpaid" ? (
                              <>
                                Code{" "}
                                <span
                                  className="font-mono"
                                  style={{
                                    letterSpacing: "0.06em",
                                    color: "var(--color-text-dark)",
                                  }}
                                >
                                  {formatPayCode(session.payCode)}
                                </span>{" "}
                                — the videos open once it&apos;s paid
                              </>
                            ) : session.paymentStatus === "Free" ? (
                              "Free game — open to the player"
                            ) : (
                              "The player can watch and download"
                            )}
                          </div>
                        </div>
                      ),
                    },
                    {
                      label: "Length",
                      value:
                        session.status === "Waiting"
                          ? "Starts when a device pairs"
                          : !session.endAt
                            ? `${formatMinutes(session.durationMinutes)} so far — until End game`
                            : formatMinutes(session.durationMinutes),
                    },
                    {
                      label: "Footage",
                      // CR-006: one video per camera, made after the game ends
                      value:
                        session.videosTotal > 0
                          ? session.status === "Processing"
                            ? session.uploadPercent != null
                              ? `Uploading ${session.uploadPercent}%`
                              : "Being made on the recorder box"
                            : `${session.videosReady}/${session.videosTotal} ${session.videosTotal === 1 ? "video" : "videos"} ready`
                          : session.status === "Cancelled"
                            ? "—"
                            : "One video per camera, after the game ends",
                    },
                    {
                      // CR-013: saves from the courtside device, of the most allowed
                      label: "Saves",
                      value: `${captures.length} of ${session.maxCaptures ?? 5}`,
                    },
                    {
                      label: "Player",
                      value: decodeHTML(session.playerName) || "—",
                    },
                    {
                      label: "Phone",
                      value: formatPhoneDisplay(session.phone) || "—",
                    },
                    {
                      label: "Player link",
                      value:
                        session.status === "Cancelled" ? (
                          "—"
                        ) : (
                          <a
                            href={session.shareUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="break-all hover:underline"
                            style={{ color: "var(--color-link)" }}
                          >
                            {session.shareUrl}
                          </a>
                        ),
                    },
                    // The player's own live stream — shown while it can run,
                    // or while one is still set
                    ...(showStream
                      ? [
                          {
                            label: "Live stream",
                            value: (
                              <SessionStreamLine
                                sessionId={session.sessionId}
                                stream={session.stream || null}
                                canWrite={canWrite}
                              />
                            ),
                          },
                        ]
                      : []),
                  ]}
                />

                {showDevices && (
                  <SessionDevices
                    session={session}
                    canWrite={canWrite}
                    onPairDevice={onPairDevice}
                  />
                )}

                {/* CR-003 / CR-006: the whole game, one video per camera */}
                {videos.length > 0 && (
                  <div
                    className="mt-6 overflow-hidden"
                    style={{
                      border: "1px solid var(--color-line)",
                      borderRadius: 10,
                    }}
                  >
                    <div
                      className="px-3.5 py-2.5 uppercase"
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: "0.08em",
                        color: "var(--color-text-muted)",
                        background: "var(--color-surface-sunken)",
                      }}
                    >
                      Whole video
                    </div>
                    {videos.map((video) => (
                      <WholeVideoRow
                        key={video.camera}
                        video={video}
                        sessionId={session.sessionId}
                        canWrite={canWrite}
                      />
                    ))}
                  </div>
                )}

                {captures.length > 0 && (
                  <div
                    className="mt-6 overflow-hidden"
                    style={{
                      border: "1px solid var(--color-line)",
                      borderRadius: "var(--radius-card)",
                    }}
                  >
                    <div
                      className="px-3.5 py-2.5 uppercase"
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: "0.08em",
                        color: "var(--color-text-muted)",
                        background: "var(--color-surface-sunken)",
                      }}
                    >
                      Saved from the court ({captures.length})
                    </div>
                    {captures.map((capture) => (
                      <div key={capture.captureId}>
                        <div
                          className="px-3.5 pt-3 font-semibold"
                          style={{
                            fontSize: 13,
                            color: "var(--color-text-dark)",
                            borderTop: "1px solid var(--color-line)",
                          }}
                        >
                          Save {capture.number} · {clockOf(capture.fromSeconds)}{" "}
                          – {clockOf(capture.toSeconds)}
                        </div>
                        {capture.videos.map((video) => (
                          <WholeVideoRow
                            key={`${capture.captureId}-${video.camera}`}
                            video={video}
                            sessionId={session.sessionId}
                            canWrite={false}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                )}

                {videos.length === 0 && (
                  <p
                    className="m-0 mt-6"
                    style={{ fontSize: 13, color: "var(--color-text-muted)" }}
                  >
                    {session.status === "Cancelled"
                      ? "This game was cancelled — nothing was recorded."
                      : "The game's video (one per camera) is made by the recorder box after the game ends."}
                  </p>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          {session && (
            <div
              className="flex flex-wrap justify-end gap-3 p-6 pt-5"
              style={{
                borderTop: "1px solid var(--color-line)",
                paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))",
              }}
            >
              {canWrite && session.status === "Recording" && (
                <Button
                  type="button"
                  variant="destructive"
                  size="lg"
                  className="sm:mr-auto"
                  disabled={endMutation.isPending}
                  onClick={handleEnd}
                >
                  <Square />
                  End game
                </Button>
              )}
              {canWrite &&
                ["Waiting", "Scheduled"].includes(session.status) && (
                  <Button
                    type="button"
                    variant="destructive"
                    size="lg"
                    className="sm:mr-auto"
                    disabled={cancelMutation.isPending}
                    onClick={handleCancel}
                  >
                    <Ban />
                    Cancel session
                  </Button>
                )}
              {session.status !== "Cancelled" && (
                <Button
                  type="button"
                  size="lg"
                  variant={canTakePayment ? "outline" : "default"}
                  onClick={handleCopy}
                >
                  <Copy />
                  Copy player link
                </Button>
              )}
              {canTakePayment && (
                <Button
                  type="button"
                  size="lg"
                  onClick={() => setPayOpen(true)}
                >
                  <Banknote />
                  Record payment
                </Button>
              )}
            </div>
          )}
        </div>
      </SheetContent>
      <GamePaymentFormModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        onSuccess={() => setPayOpen(false)}
        session={session}
      />
    </Sheet>
  );
};

export default SessionDetailSheet;
