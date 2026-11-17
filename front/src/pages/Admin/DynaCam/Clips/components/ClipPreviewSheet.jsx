import { Banknote, Copy, Download, Film, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import DescriptionList from "../../../../../components/DescriptionList";
import StatusDot from "../../../../../components/StatusDot";
import PaymentStatusChip from "../../../../../components/PaymentStatusChip";
import SourceChip from "./SourceChip";
import { decodeHTML } from "../../../../../utils/decode-html";
import { getImageUrl } from "../../../../../utils/upload";
import {
  CLIP_STATUS_TONE,
  formatBytes,
  formatDate,
  formatDateTime,
  formatDuration,
  formatPayCode,
  formatPeso,
} from "../../../../../utils/dynaCam";

/**
 * Read-only clip preview: the video, its details, and the share / delete
 * actions. Not a form, so it takes the clip plus the actions it offers.
 *
 * @param {boolean} open
 * @param {() => void} onClose
 * @param {object|null} clip       a row from the clips list
 * @param {boolean} canWrite       shows Delete
 * @param {(clip) => void} onCopyLink
 * @param {(clip) => void} onDelete
 * @param {boolean} canTakePayment  shows "Record cash payment" on Unpaid clips
 * @param {boolean} isRecordingPayment
 * @param {(clip) => void} onRecordPayment
 */
const ClipPreviewSheet = ({
  open,
  onClose,
  clip,
  canWrite,
  onCopyLink,
  onDelete,
  canTakePayment,
  isRecordingPayment,
  onRecordPayment,
}) => {
  const unpaid = clip?.paymentStatus === "Unpaid";
  const payable = unpaid && ["Pending", "Processing", "Ready"].includes(clip?.status);
  const videoSrc = getImageUrl(clip?.videoUrl);
  // Signed `&download=1` link — the server answers it as an attachment
  const downloadHref = getImageUrl(clip?.downloadUrl);

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
            {/* Header — accent chip + title + subtitle + bordered X */}
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
                    {decodeHTML(clip?.courtName) || "Clip"}
                  </SheetTitle>
                  <SheetDescription
                    className="m-0 mt-0.5 truncate"
                    style={{ fontSize: 13, color: "var(--color-text-secondary)" }}
                  >
                    {decodeHTML(clip?.venueName)} ·{" "}
                    {formatDateTime(clip?.requestedAt)}
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

            {/* Player */}
            {videoSrc ? (
              <video
                key={videoSrc}
                src={videoSrc}
                poster={getImageUrl(clip?.thumbnailUrl) || undefined}
                controls
                playsInline
                preload="metadata"
                className="w-full block"
                style={{
                  aspectRatio: "16 / 9",
                  borderRadius: 12,
                  border: "1px solid var(--color-line)",
                  background: "var(--color-surface-sunken)",
                }}
              />
            ) : (
              <div
                className="w-full flex items-center justify-center"
                style={{
                  aspectRatio: "16 / 9",
                  borderRadius: 12,
                  border: "1px solid var(--color-line)",
                  background: "var(--color-surface-sunken)",
                  color: "var(--color-text-muted)",
                  fontSize: 13.5,
                }}
              >
                The video is only available while the clip is Ready.
              </div>
            )}

            {/* Details */}
            <div className="mt-6">
              <DescriptionList
                items={[
                  {
                    label: "Status",
                    value: (
                      <StatusDot tone={CLIP_STATUS_TONE[clip?.status] || "muted"}>
                        {clip?.status}
                      </StatusDot>
                    ),
                  },
                  {
                    label: "Saved by",
                    value: <SourceChip source={clip?.source} partIndex={clip?.partIndex} />,
                  },
                  {
                    label: "Payment",
                    value: (
                      <PaymentStatusChip
                        paymentStatus={clip?.paymentStatus}
                        price={clip?.price}
                      />
                    ),
                  },
                  ...(unpaid && clip?.payCode
                    ? [
                        {
                          label: "Pay code",
                          value: (
                            <span
                              className="font-mono font-semibold"
                              style={{ letterSpacing: "0.08em" }}
                            >
                              {formatPayCode(clip.payCode)}
                            </span>
                          ),
                        },
                      ]
                    : []),
                  { label: "Length", value: formatDuration(clip?.durationSeconds) },
                  { label: "File size", value: formatBytes(clip?.sizeBytes) },
                  { label: "Available until", value: formatDate(clip?.expiresAt) },
                  {
                    label: "Share link",
                    value: (
                      <a
                        href={clip?.shareUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-all hover:underline"
                        style={{ color: "var(--color-link)" }}
                      >
                        {clip?.shareUrl}
                      </a>
                    ),
                  },
                ]}
              />
            </div>
          </div>

          {/* Footer */}
          <div
            className="flex flex-wrap justify-end gap-3 p-6 pt-5"
            style={{
              borderTop: "1px solid var(--color-line)",
              paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))",
            }}
          >
            {canWrite && (
              <Button
                type="button"
                variant="destructive"
                size="lg"
                className="sm:mr-auto"
                onClick={() => onDelete?.(clip)}
              >
                <Trash2 />
                Delete
              </Button>
            )}
            {canTakePayment && payable && (
              <Button
                type="button"
                variant="outline"
                size="lg"
                disabled={isRecordingPayment}
                onClick={() => onRecordPayment?.(clip)}
              >
                <Banknote />
                Record cash payment · {formatPeso(clip?.price)}
              </Button>
            )}
            {downloadHref && (
              <Button asChild variant="outline" size="lg">
                <a href={downloadHref} download>
                  <Download />
                  Download
                </a>
              </Button>
            )}
            <Button type="button" size="lg" onClick={() => onCopyLink?.(clip)}>
              <Copy />
              Copy share link
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default ClipPreviewSheet;
