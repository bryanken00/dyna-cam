import { Ban, Copy, Download, Film, Square, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import SessionDevices from "./SessionDevices";
import SessionStreamLine from "./SessionStreamLine";
import DescriptionList from "../../../../../components/DescriptionList";
import Spinner from "../../../../../components/Spinner";
import StatusDot from "../../../../../components/StatusDot";
import { confirm } from "../../../../../store/confirmStore";
import { copyText } from "../../../../../utils/clipboard";
import { decodeHTML } from "../../../../../utils/decode-html";
import { formatPhoneDisplay } from "../../../../../utils/phoneFormat";
import { getImageUrl } from "../../../../../utils/upload";
import {
  CLIP_STATUS_TONE,
  SESSION_STATUS_TONE,
  formatDate,
  formatMinutes,
  formatTimeRange,
  partLabel,
} from "../../../../../utils/dynaCam";
import {
  useCancelSession,
  useEndSession,
  useGetSessionById,
} from "../../../../../services/requests/admin/sessions";

/** One 5-minute part: label, window, status, and the player + download when Ready. */
const PartRow = ({ part }) => {
  const ready = part.status === "Ready";
  const videoSrc = getImageUrl(part.videoUrl);
  const downloadHref = getImageUrl(part.downloadUrl);
  return (
    <div
      className="p-3.5"
      style={{ borderTop: "1px solid var(--color-line)" }}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <span
            className="font-semibold"
            style={{ fontSize: 13.5, color: "var(--color-text-dark)" }}
          >
            {partLabel(part.partIndex)}
          </span>
          <span style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
            {" · "}
            {formatTimeRange(part.windowStartAt, part.windowEndAt)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <StatusDot
            tone={CLIP_STATUS_TONE[part.status] || "muted"}
            title={part.failureReason || undefined}
          >
            {part.status}
          </StatusDot>
          {ready && downloadHref && (
            <Button asChild variant="outline" size="sm">
              <a href={downloadHref} download>
                <Download />
                Download
              </a>
            </Button>
          )}
        </div>
      </div>
      {part.status === "Failed" && part.failureReason && (
        <p className="m-0 mt-1" style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
          {part.failureReason}
        </p>
      )}
      {ready && videoSrc && (
        <video
          key={videoSrc}
          src={videoSrc}
          poster={getImageUrl(part.thumbnailUrl) || undefined}
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
 * Session detail: its devices (pair / unpair, live keys) and its parts —
 * refreshes while the session is live. Not a form — takes the session id,
 * the write flag, and `onPairDevice(session)` (the page owns the pairing
 * dialogs so a booking can open them too).
 */
const SessionDetailSheet = ({ open, onClose, sessionId, canWrite, onPairDevice }) => {
  const { data, isLoading, error } = useGetSessionById(open ? sessionId : null);
  const session = data?.data?.session || null;
  const parts = session?.parts || [];
  // While it can take a device, or while one is still paired (the device
  // keeps the download QR for a few minutes after the end)
  const showDevices =
    ["Scheduled", "Recording"].includes(session?.status) ||
    (session?.devices || []).some((d) => d.status === "Active");
  const showStream =
    !!session?.stream || ["Scheduled", "Recording"].includes(session?.status);
  const remaining = Math.max(0, (Number(session?.partsTotal) || 0) - parts.length);

  const cancelMutation = useCancelSession();
  const endMutation = useEndSession();

  const handleCopy = async () => {
    const ok = await copyText(session?.shareUrl);
    if (ok) toast.success("Player link copied");
    else toast.error("Couldn't copy the link");
  };

  const handleEnd = async () => {
    const ok = await confirm({
      title: "End session now",
      description:
        "Stop recording now? The footage so far is still saved and sent to the player link.",
      confirmText: "End now",
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
                    style={{ fontSize: 13, color: "var(--color-text-secondary)" }}
                  >
                    {session
                      ? `${decodeHTML(session.venueName)} · ${formatDate(
                          session.startAt,
                        )}, ${formatTimeRange(session.startAt, session.endAt)}`
                      : "Loading…"}
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
              <p style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}>
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
                          <StatusDot tone={SESSION_STATUS_TONE[session.status] || "muted"}>
                            {session.status}
                          </StatusDot>
                          {session.failureReason && (
                            <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                              {session.failureReason}
                            </div>
                          )}
                        </div>
                      ),
                    },
                    { label: "Length", value: formatMinutes(session.durationMinutes) },
                    {
                      label: "Footage",
                      value: `${session.partsReady}/${session.partsTotal} parts ready`,
                    },
                    { label: "Player", value: decodeHTML(session.playerName) || "—" },
                    { label: "Phone", value: formatPhoneDisplay(session.phone) || "—" },
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

                {/* Parts */}
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
                    Parts
                  </div>
                  {parts.map((part) => (
                    <PartRow key={part.clipId} part={part} />
                  ))}
                  {parts.length === 0 && (
                    <p
                      className="m-0 p-3.5"
                      style={{
                        fontSize: 13,
                        color: "var(--color-text-muted)",
                        borderTop: "1px solid var(--color-line)",
                      }}
                    >
                      {session.status === "Scheduled"
                        ? "Parts appear here once recording starts."
                        : session.status === "Cancelled"
                          ? "This session was cancelled — nothing was recorded."
                          : "No parts yet."}
                    </p>
                  )}
                  {remaining > 0 &&
                    ["Scheduled", "Recording"].includes(session.status) &&
                    parts.length > 0 && (
                      <p
                        className="m-0 p-3.5"
                        style={{
                          fontSize: 13,
                          color: "var(--color-text-muted)",
                          borderTop: "1px solid var(--color-line)",
                        }}
                      >
                        {remaining} more {remaining === 1 ? "part" : "parts"} to
                        come — one every 5 minutes.
                      </p>
                    )}
                </div>
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
                  End now
                </Button>
              )}
              {canWrite && session.status === "Scheduled" && (
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
                <Button type="button" size="lg" onClick={handleCopy}>
                  <Copy />
                  Copy player link
                </Button>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default SessionDetailSheet;
