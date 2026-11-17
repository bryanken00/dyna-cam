import { useState } from "react";
import { Check, Copy, KeyRound, TriangleAlert } from "lucide-react";
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
import { copyText } from "../../../../../utils/clipboard";
import { confirm } from "../../../../../store/confirmStore";

/** The API address a recorder box talks to — the same one this app uses. */
const API_URL = (
  import.meta.env.VITE_API_URL || window.location.origin
).replace(/\/+$/, "");

/** Mono, bordered block with a copy button. */
const CopyBlock = ({ label, value, copied, onCopy }) => (
  <div>
    <div
      className="flex items-center justify-between gap-2 mb-1.5"
      style={{ fontSize: 12.5, fontWeight: 500, color: "var(--color-text-secondary)" }}
    >
      {label}
      <Button type="button" variant="outline" size="sm" onClick={onCopy}>
        {copied ? <Check /> : <Copy />}
        {copied ? "Copied" : "Copy"}
      </Button>
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
      {value}
    </pre>
  </div>
);

/**
 * Shows a recorder box's sign-in token — the only time it is ever visible —
 * plus the two `.env` lines the installer pastes into the box. Mount it with
 * `key={token}` so the "copied" state starts fresh for every token.
 *
 * @param {boolean} open
 * @param {() => void} onClose
 * @param {string} deviceName
 * @param {string} token
 */
const DeviceTokenDialog = ({ open, onClose, deviceName, token }) => {
  const [copied, setCopied] = useState({ token: false, env: false });
  const envLines = `API_URL=${API_URL}\nDEVICE_TOKEN=${token || ""}`;

  const handleCopy = async (which, text) => {
    const ok = await copyText(text);
    if (ok) {
      setCopied((prev) => ({ ...prev, [which]: true }));
      toast.success(which === "token" ? "Token copied" : "Settings copied");
    } else {
      toast.error("Couldn't copy — select the text and copy it by hand");
    }
  };

  const handleClose = async () => {
    if (!copied.token && !copied.env) {
      const ok = await confirm({
        title: "Close without copying?",
        description:
          "This token won't be shown again. If you close now you'll have to issue a new one.",
        confirmText: "Close anyway",
        cancelText: "Go back",
        danger: true,
      });
      if (!ok) return;
    }
    onClose();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose();
      }}
    >
      <DialogContent
        className="sm:max-w-140"
        // A stray click outside must not throw the token away
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="w-4.5 h-4.5" />
            Token for {deviceName || "recorder box"}
          </DialogTitle>
          <DialogDescription>
            Paste this into the box&apos;s settings so it can sign in.
          </DialogDescription>
        </DialogHeader>

        <div
          className="flex items-start gap-2.5 px-3.5 py-3"
          style={{
            border: "1px solid var(--color-line)",
            borderRadius: 10,
            fontSize: 13,
            color: "var(--color-text-dark)",
          }}
        >
          <TriangleAlert
            className="w-4 h-4 mt-0.5 shrink-0"
            style={{ color: "var(--color-warning)" }}
          />
          <span>
            <strong className="font-semibold">You won&apos;t see this token again.</strong>{" "}
            Copy it now. If it is lost, issue a new one from the box&apos;s ⋮ menu.
          </span>
        </div>

        <div className="space-y-4">
          <CopyBlock
            label="Device token"
            value={token}
            copied={copied.token}
            onCopy={() => handleCopy("token", token)}
          />
          <CopyBlock
            label="The box's .env file"
            value={envLines}
            copied={copied.env}
            onCopy={() => handleCopy("env", envLines)}
          />
        </div>

        <DialogFooter>
          <Button type="button" onClick={handleClose}>
            I&apos;ve saved it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DeviceTokenDialog;
