import { QRCodeSVG } from "qrcode.react";
import { Cloud, Copy, ExternalLink } from "lucide-react";
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
import { decodeHTML } from "../../../../../utils/decode-html";

/**
 * CR-001 (2026-11-20): a finished game's Google Drive folder as a QR code and
 * a link, for staff to show or send the player. The folder is shared "anyone
 * with the link", so it opens on a phone with no Google sign-in.
 *
 * Props: `{ open, onClose, session }` — `session` needs `driveUrl`,
 * `courtName`, `venueName` and, optionally, `playerName`.
 */
const GameDriveDialog = ({ open, onClose, session }) => {
  const url = session?.driveUrl || "";

  const handleCopy = async () => {
    const ok = await copyText(url);
    if (ok) toast.success("Google Drive link copied");
    else toast.error("Couldn't copy the link");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="sm:max-w-105">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cloud className="w-4.5 h-4.5" />
            Game in Google Drive
          </DialogTitle>
          <DialogDescription>
            {session ? (
              <>
                {decodeHTML(session.courtName)} · {decodeHTML(session.venueName)}
                {session.playerName ? ` · ${decodeHTML(session.playerName)}` : ""}. The player
                scans this to open the game&apos;s folder — no Google account needed.
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        {url ? (
          <div className="flex flex-col items-center gap-3">
            {/* The QR draws its own light quiet zone, so it scans in either theme */}
            <div
              className="p-3"
              style={{
                background: "var(--color-surface)",
                borderRadius: 12,
                border: "1px solid var(--color-line)",
              }}
            >
              <QRCodeSVG
                value={url}
                size={232}
                level="M"
                marginSize={1}
                title="QR code for the game's Google Drive folder"
              />
            </div>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-center hover:underline"
              style={{ fontSize: 13, color: "var(--color-link)" }}
            >
              {url}
            </a>
            <p
              className="m-0 text-center"
              style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}
            >
              The Drive copy is deleted with the game&apos;s videos when the
              venue&apos;s keep time ends.
            </p>
          </div>
        ) : (
          <p className="m-0" style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}>
            This game has no Google Drive copy.
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleCopy} disabled={!url}>
            <Copy />
            Copy link
          </Button>
          <Button asChild disabled={!url}>
            <a href={url || undefined} target="_blank" rel="noopener noreferrer">
              <ExternalLink />
              Open in Google Drive
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default GameDriveDialog;
