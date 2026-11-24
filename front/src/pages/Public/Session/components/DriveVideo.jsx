import { QRCodeSVG } from "qrcode.react";
import { Cloud, CloudOff } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * CR-040: players get a video only from Google Drive, never from this site.
 * Ready and on Drive: "Open in Google Drive" (and, on a wide screen, a QR to
 * open it on a phone); kept at the venue because the court has no usable
 * Drive, or saved before videos moved to Drive and not there: says so.
 *
 * Props: `video` (a game page video), `label` — the button's words, `qr` —
 * show the QR on wide screens (the whole game only).
 */
const DriveVideo = ({ video, label = "Open in Google Drive", qr = false }) => {
  const muted = { fontSize: 13, color: "var(--color-text-secondary)" };

  if (video.status === "Ready" && video.driveUrl) {
    return (
      <div className="p-3 flex items-center gap-4">
        <div className="flex-1 min-w-0 space-y-2">
          <Button asChild size="lg" className="h-11 w-full">
            <a href={video.driveUrl} target="_blank" rel="noopener noreferrer">
              <Cloud />
              {label}
            </a>
          </Button>
          <p className="m-0" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
            Watch or download it in Google Drive — no Google account needed.
          </p>
        </div>
        {qr && (
          // The QR draws its own light quiet zone, so it scans in either theme
          <div
            className="hidden md:block shrink-0 p-2"
            style={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-line)",
              borderRadius: 10,
            }}
          >
            <QRCodeSVG
              value={video.driveUrl}
              size={96}
              level="M"
              marginSize={1}
              title="Scan to open this video on your phone"
            />
          </div>
        )}
      </div>
    );
  }

  // Saved on the server before CR-040 and never copied to Drive
  if (video.status === "Ready" && video.delivery !== "Drive") {
    return (
      <div className="flex items-start gap-2 px-4 pb-3" style={muted}>
        <CloudOff className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "var(--color-text-muted)" }} />
        <p className="m-0">
          This video isn&apos;t on Google Drive — ask the front desk.
        </p>
      </div>
    );
  }

  if (video.status === "Ready" && video.driveState === "NotShared") {
    return (
      <div className="flex items-start gap-2 px-4 pb-3" style={muted}>
        <CloudOff className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "var(--color-text-muted)" }} />
        <p className="m-0">
          This video isn&apos;t on Google Drive yet — the court&apos;s Google Drive isn&apos;t
          connected. The venue is keeping it for now; ask the front desk.
        </p>
      </div>
    );
  }

  return null;
};

export default DriveVideo;
