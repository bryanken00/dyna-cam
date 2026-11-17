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

const mmss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * Shows a new 6-digit key that pairs a phone or tablet to a session — the
 * only time its digits are visible — with a live countdown to its expiry
 * (counted from when the key arrived, so the browser's clock/zone doesn't
 * matter). Recorder boxes don't pair here: they enrol from their `.env`.
 *
 * @param {boolean} open
 * @param {() => void} onClose
 * @param {{ code, name, courtName?, receivedAt, expiresInSeconds? }} pairingKey
 *        receivedAt: Date.now() when the API answered. expiresInSeconds (when
 *        the API sends it) wins over the default 10 minutes — a session key
 *        also stops when the session ends.
 */
const PairingKeyDialog = ({ open, onClose, pairingKey }) => {
  const ttlSeconds = Number(pairingKey?.expiresInSeconds);
  const ttlMs = Number.isFinite(ttlSeconds) ? ttlSeconds * 1000 : PAIRING_KEY_TTL_MS;
  const expiresAtMs = (pairingKey?.receivedAt || 0) + ttlMs;
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

  const handleCopy = async () => {
    const ok = await copyText(code);
    if (ok) {
      setCopied(true);
      toast.success("Key copied");
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
            Pairing key for {pairingKey?.name || "the device"}
          </DialogTitle>
          <DialogDescription>
            Type this key into the Dyna Cam app on the device.
            {pairingKey?.courtName &&
              ` It pairs with this session on ${pairingKey.courtName}.`}
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

        <p className="m-0" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
          It works until the session ends at the latest. The device shows under
          the session&apos;s Devices as soon as it pairs. You won&apos;t see these
          digits again.
        </p>

        <DialogFooter>
          {!expired && (
            <Button type="button" variant="outline" onClick={handleCopy}>
              {copied ? <Check /> : <Copy />}
              Copy key
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
