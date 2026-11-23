import { QRCodeSVG } from "qrcode.react";
import { Copy, ExternalLink, Globe, Power, Printer, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import SetupSection from "../../CourtSetup/components/SetupSection";
import StatusDot from "../../../../../components/StatusDot";

/**
 * PLAN-003: the venue's online booking link — players open it (or scan its QR)
 * to book a court. Off until staff turn it on; a new link retires the old one.
 */
const BookingLinkSection = ({
  settings,
  canWrite,
  isIssuing,
  isTurningOff,
  onIssue,
  onTurnOff,
  onCopy,
  onPrint,
}) => {
  const enabled = settings.bookingEnabled;

  return (
    <SetupSection
      id="booking-link"
      title="Online booking"
      description="Players open this link, or scan its QR, to pick a court and time and book it. Share it on your page and put the sign up at the desk."
      aside={
        <StatusDot tone={enabled ? "success" : "muted"}>{enabled ? "On" : "Off"}</StatusDot>
      }
    >
      {enabled ? (
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
              value={settings.bookingUrl}
              size={128}
              level="M"
              marginSize={1}
              title="Booking QR code"
            />
          </div>
          <div className="flex-1 min-w-60 space-y-3">
            <div>
              <div style={{ fontSize: 12.5, color: "var(--color-text-secondary)" }}>
                Booking link
              </div>
              <div
                className="font-mono break-all"
                style={{ fontSize: 12.5, color: "var(--color-text-dark)" }}
              >
                {settings.bookingUrl}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button type="button" onClick={onPrint}>
                <Printer />
                Print sign
              </Button>
              <Button type="button" variant="outline" onClick={onCopy}>
                <Copy />
                Copy link
              </Button>
              <Button asChild variant="outline">
                <a href={settings.bookingUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink />
                  Open
                </a>
              </Button>
              {canWrite && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onIssue}
                    disabled={isIssuing}
                  >
                    <RefreshCcw />
                    Issue new link
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onTurnOff}
                    disabled={isTurningOff}
                  >
                    <Power />
                    Turn off
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <p className="m-0" style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}>
            Online booking is off. The desk can still take bookings.
          </p>
          {canWrite && (
            <Button type="button" onClick={onIssue} disabled={isIssuing}>
              <Globe />
              Turn on online booking
            </Button>
          )}
        </div>
      )}
    </SetupSection>
  );
};

export default BookingLinkSection;
