import { useEffect, useState } from "react";
import { Check, Copy, KeyRound, TimerOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { copyText } from "../utils/clipboard";
import { PAIRING_KEY_TTL_MS, formatPairingKey } from "../utils/dynaCam";

/** The API address a recorder box talks to — the same one this app uses. */
const API_URL = (import.meta.env.VITE_API_URL || window.location.origin).replace(
  /\/+$/,
  "",
);

const mmss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * Shows a new 6-digit pairing key — the only time its digits are visible —
 * with a live countdown to its 10-minute expiry (counted from when the key
 * arrived, so the browser's clock/zone doesn't matter).
 *
 * @param {boolean} open
 * @param {() => void} onClose
 * @param {"recorder"|"app"} kind  a recorder box also gets its `.env` lines
 * @param {{ code, name, venueName, receivedAt }} pairingKey
 *        receivedAt: Date.now() when the API answered
 */
const PairingKeyDialog = ({ open, onClose, kind, pairingKey }) => {
  const expiresAtMs = (pairingKey?.receivedAt || 0) + PAIRING_KEY_TTL_MS;
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open]);

  const left = expiresAtMs - now;
  const expired = left <= 0;
  const code = pairingKey?.code || "";
  const isRecorder = kind === "recorder";
  const envLines = `API_URL=${API_URL}\nPAIRING_CODE=${code}`;

  const handleCopy = async (text, what) => {
    const ok = await copyText(text);
    if (ok) {
      setCopied(true);
      toast.success(`${what} copied`);
    } else {
      toast.error("Couldn't copy — read the key off the screen instead");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="sm:max-w-130">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="w-4.5 h-4.5" />
            Pairing key for {pairingKey?.name || (isRecorder ? "the box" : "the phone")}
          </DialogTitle>
          <DialogDescription>
            {isRecorder
              ? "On the recorder box, put these two lines in its .env file and start it. The box swaps the key for its own token and keeps it."
              : "On the phone, open the Dyna Cam staff app and enter this key."}
            {pairingKey?.venueName && ` It pairs with ${pairingKey.venueName}.`}
          </DialogDescription>
        </DialogHeader>

        {/* The key, big and spaced */}
        <div
          className="py-5 px-3 text-center"
          style={{
            border: "1px dashed var(--color-line)",
            borderRadius: 12,
            background: "var(--color-surface-sunken)",
            opacity: expired ? 0.5 : 1,
          }}
        >
          <div
            className="font-mono font-semibold select-all"
            aria-label={`Pairing key ${code.split("").join(" ")}`}
            style={{
              fontSize: 40,
              letterSpacing: "0.14em",
              color: "var(--color-text-dark)",
              textDecoration: expired ? "line-through" : "none",
            }}
          >
            {formatPairingKey(code)}
          </div>
          <div
            className="mt-1.5 inline-flex items-center gap-1.5"
            aria-live="polite"
            style={{
              fontSize: 13,
              color: expired ? "var(--color-error)" : "var(--color-text-secondary)",
            }}
          >
            {expired ? (
              <>
                <TimerOff className="w-3.5 h-3.5" />
                Expired — create a new key
              </>
            ) : (
              <>
                Works once · expires in{" "}
                <span className="font-mono" style={{ color: "var(--color-text-dark)" }}>
                  {mmss(left)}
                </span>
              </>
            )}
          </div>
        </div>

        {isRecorder && !expired && (
          <div>
            <div
              className="mb-1.5"
              style={{ fontSize: 12.5, fontWeight: 500, color: "var(--color-text-secondary)" }}
            >
              The box&apos;s .env file
            </div>
            <pre
              className="font-mono m-0 whitespace-pre-wrap break-all select-all"
              style={{
                fontSize: 12.5,
                lineHeight: 1.6,
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid var(--color-line)",
                background: "var(--color-surface-sunken)",
                color: "var(--color-text-dark)",
              }}
            >
              {envLines}
            </pre>
          </div>
        )}

        <p className="m-0" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
          {isRecorder
            ? "The box appears under Recorder Boxes as soon as it pairs. "
            : "The phone appears in the list as soon as it pairs. "}
          You won&apos;t see these digits again.
        </p>

        <DialogFooter>
          {!expired && (
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                isRecorder ? handleCopy(envLines, ".env lines") : handleCopy(code, "Key")
              }
            >
              {copied ? <Check /> : <Copy />}
              {isRecorder ? "Copy .env lines" : "Copy key"}
            </Button>
          )}
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PairingKeyDialog;
