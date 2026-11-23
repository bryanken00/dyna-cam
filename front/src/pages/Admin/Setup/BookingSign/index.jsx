import { QRCodeSVG } from "qrcode.react";
import { CalendarCheck, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBookingSignHooks } from "./hooks";
import ResultState from "../../../../components/ResultState";
import Spinner from "../../../../components/Spinner";
import { getImageUrl } from "../../../../utils/upload";
import { formatPhoneDisplay } from "../../../../utils/phoneFormat";

const APP_NAME = import.meta.env.VITE_APP_NAME || "Dyna Cam";

/**
 * A5 "Book a court" sign (148 × 210 mm): venue logo + name, a large QR code to
 * the venue's online booking page, the instruction line and the desk's phone.
 * Opened in its own tab from the venue page → Online booking → Print sign.
 */
const BookingSignPage = () => {
  const { settings, venueName, venuePhone, logoUrl, bookingUrl, isLoading, error, handlePrint } =
    useBookingSignHooks();

  if (isLoading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "var(--color-canvas)" }}
      >
        <Spinner tip="Preparing the sign…" />
      </div>
    );
  }

  if (error || !settings || !bookingUrl) {
    const missing = error?.response?.status === 404 || !settings;
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "var(--color-canvas)" }}
      >
        <ResultState
          status={missing ? "404" : "error"}
          title={missing ? "Venue not found" : error ? "Couldn't load the sign" : "Online booking is off"}
          description={
            missing
              ? "This venue may have been deleted. Close this tab and pick it again from Venues."
              : "Turn online booking on from the venue page, then print the sign again."
          }
        />
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center gap-5 py-8 px-4 print:block print:p-0 print:min-h-0"
      style={{ background: "var(--color-canvas)" }}
    >
      {/* One A5 sheet, no browser margins */}
      <style>{"@page { size: A5 portrait; margin: 0; }"}</style>

      {/* Toolbar — screen only */}
      <div className="w-full max-w-[148mm] flex items-center justify-between gap-3 print:hidden">
        <p className="m-0" style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
          A5 sign · print at 100% scale
        </p>
        <Button onClick={handlePrint}>
          <Printer />
          Print
        </Button>
      </div>

      {/* The sign */}
      <div
        className="flex flex-col items-center text-center overflow-hidden print:border-0!"
        style={{
          width: "148mm",
          height: "210mm",
          padding: "14mm 12mm 10mm",
          background: "var(--color-surface)",
          border: "1px solid var(--color-line)",
          color: "var(--color-text-dark)",
          boxSizing: "border-box",
        }}
      >
        {/* Venue */}
        <div className="flex flex-col items-center gap-2">
          {logoUrl && (
            <img
              src={getImageUrl(logoUrl)}
              alt=""
              style={{ maxHeight: "16mm", maxWidth: "60mm", objectFit: "contain" }}
            />
          )}
          <div style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-secondary)" }}>
            {venueName}
          </div>
        </div>

        <h1
          className="m-0 mt-3 font-semibold leading-tight"
          style={{ fontSize: 40, letterSpacing: "-1px" }}
        >
          Book a court
        </h1>

        {/* QR */}
        <div
          className="mt-6 flex items-center justify-center"
          style={{
            padding: "4mm",
            border: "1px solid var(--color-line)",
            borderRadius: 14,
          }}
        >
          <QRCodeSVG
            value={bookingUrl}
            size={340}
            level="M"
            marginSize={0}
            style={{ width: "88mm", height: "88mm" }}
            title={`Booking QR code for ${venueName}`}
          />
        </div>

        {/* Instruction */}
        <div className="mt-6 flex items-center gap-2.5 justify-center">
          <CalendarCheck className="w-6 h-6 shrink-0" style={{ color: "var(--color-text-dark)" }} />
          <p className="m-0 font-semibold" style={{ fontSize: 19, letterSpacing: "-0.2px" }}>
            Scan to pick a court and time
          </p>
        </div>
        <p className="m-0 mt-1.5" style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
          Pay online or at the desk. Your game is recorded when you check in.
        </p>

        {/* Desk + brand */}
        <div className="mt-auto pt-4 w-full" style={{ borderTop: "1px solid var(--color-line)" }}>
          {venuePhone && (
            <p className="m-0" style={{ fontSize: 11.5, color: "var(--color-text-secondary)" }}>
              Questions? Call the desk: {formatPhoneDisplay(venuePhone)}
            </p>
          )}
          <p
            className="m-0 mt-1 uppercase"
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.1em",
              color: "var(--color-text-muted)",
            }}
          >
            {APP_NAME}
          </p>
        </div>
      </div>
    </div>
  );
};

export default BookingSignPage;
