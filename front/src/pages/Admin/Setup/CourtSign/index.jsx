import { QRCodeSVG } from "qrcode.react";
import { Printer, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCourtSignHooks } from "./hooks";
import ResultState from "../../../../components/ResultState";
import Spinner from "../../../../components/Spinner";
import { getImageUrl } from "../../../../utils/upload";
import { APP_NAME } from "../../../../components/brand/appName";


/**
 * A5 court sign (148 × 210 mm): venue logo + name, court name, a large QR code
 * to the court's player page, the instruction line and a privacy note.
 * Opened in its own tab from Courts → "Print QR sign"; the toolbar is hidden
 * when printing and the page is sized to one A5 sheet.
 */
const CourtSignPage = () => {
  const { court, courtName, venueName, logoUrl, isLoading, error, handlePrint } =
    useCourtSignHooks();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--color-canvas)" }}>
        <Spinner tip="Preparing the sign…" />
      </div>
    );
  }

  if (error || !court) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--color-canvas)" }}>
        <ResultState
          status={error?.response?.status === 404 || !court ? "404" : "error"}
          title="Court not found"
          description="This court may have been deleted. Close this tab and pick it again from Courts."
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

        {/* Court */}
        <h1
          className="m-0 mt-3 font-semibold leading-tight"
          style={{ fontSize: 40, letterSpacing: "-1px" }}
        >
          {courtName}
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
            value={court.qrUrl}
            size={340}
            level="M"
            marginSize={0}
            style={{ width: "88mm", height: "88mm" }}
            title={`QR code for ${courtName}`}
          />
        </div>

        {/* Instruction */}
        <div className="mt-6 flex items-center gap-2.5 justify-center">
          <ScanLine className="w-6 h-6 shrink-0" style={{ color: "var(--color-text-dark)" }} />
          <p className="m-0 font-semibold" style={{ fontSize: 19, letterSpacing: "-0.2px" }}>
            Scan and enter your booking code
          </p>
        </div>
        <p className="m-0 mt-1.5" style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
          Point your phone camera at the code — no app needed. No booking? Ask the front desk.
        </p>

        {/* Privacy + brand */}
        <div className="mt-auto pt-4 w-full" style={{ borderTop: "1px solid var(--color-line)" }}>
          <p className="m-0" style={{ fontSize: 11.5, color: "var(--color-text-secondary)" }}>
            Your game is recorded for your booked time, from when you check in.
          </p>
          <p
            className="m-0 mt-1 uppercase"
            style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", color: "var(--color-text-muted)" }}
          >
            {APP_NAME}
          </p>
        </div>
      </div>
    </div>
  );
};

export default CourtSignPage;
