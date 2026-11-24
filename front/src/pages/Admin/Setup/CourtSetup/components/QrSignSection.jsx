import { QRCodeSVG } from "qrcode.react";
import { Copy, ExternalLink, Printer, RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import SetupSection from "./SetupSection";
import { confirm } from "../../../../../store/confirmStore";
import { copyText } from "../../../../../utils/clipboard";
import { courtSignPath } from "../../../../../utils/dynaCam";
import { useRotateCourtQr } from "../../../../../services/requests/admin/courts";

/**
 * The court's QR sign: preview, player link, print, and issue a new code.
 * CR-034: players scan it and enter their booking code to start their booked
 * game (CR-027's walk-in Start game is gone).
 */
const QrSignSection = ({ court, canWrite }) => {
  const rotateMutation = useRotateCourtQr();

  const handleCopy = async () => {
    const ok = await copyText(court.qrUrl);
    if (ok) toast.success("Player link copied");
    else toast.error("Couldn't copy the link");
  };

  const handleRotate = async () => {
    const ok = await confirm({
      title: "Issue a new QR code",
      description:
        "The sign printed for this court stops working right away — print and put up the new one.",
      confirmText: "Issue new code",
      cancelText: "Cancel",
      danger: true,
    });
    if (ok) rotateMutation.mutate(court.courtId);
  };

  return (
    <SetupSection
      id="court-qr"
      title="QR sign"
      description="Players scan it and enter their booking code to start recording their booked game, with up to 5 saves. A game can't start from it without a booking. Print it at A5 and put it up by the court."
    >
      <div className="flex gap-5 flex-wrap items-start">
        <div
          className="shrink-0 p-2.5"
          style={{
            border: "1px solid var(--color-line)",
            borderRadius: 12,
            // A QR code needs a light quiet zone in either theme
            background: "var(--color-surface)",
          }}
        >
          <QRCodeSVG
            value={court.qrUrl}
            size={128}
            level="M"
            marginSize={1}
            title="Court QR code"
          />
        </div>
        <div className="flex-1 min-w-60 space-y-3">
          <div>
            <div style={{ fontSize: 12.5, color: "var(--color-text-secondary)" }}>
              Player link
            </div>
            <div
              className="font-mono break-all"
              style={{ fontSize: 12.5, color: "var(--color-text-dark)" }}
            >
              {court.qrUrl}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              type="button"
              onClick={() => window.open(courtSignPath(court.courtId), "_blank", "noopener")}
            >
              <Printer />
              Print sign
            </Button>
            <Button type="button" variant="outline" onClick={handleCopy}>
              <Copy />
              Copy link
            </Button>
            <Button asChild variant="outline">
              <a href={court.qrUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink />
                Open
              </a>
            </Button>
            {canWrite && (
              <Button
                type="button"
                variant="outline"
                onClick={handleRotate}
                disabled={rotateMutation.isPending}
              >
                <RefreshCcw />
                Issue new code
              </Button>
            )}
          </div>
        </div>
      </div>
    </SetupSection>
  );
};

export default QrSignSection;
