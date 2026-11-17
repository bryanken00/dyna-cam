import { useState } from "react";
import { CalendarCheck, Check, Copy, ExternalLink } from "lucide-react";
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
import { formatDate, formatTimeRange } from "../../../../../utils/dynaCam";

/**
 * After a booking: the player link staff hand to the player (it's where every
 * part of the footage appears), with copy and open.
 *
 * @param {boolean} open
 * @param {{ shareUrl, startAt, endAt, courtName, venueName, playerName }} session
 * @param {() => void} onClose
 */
const SessionBookedDialog = ({ open, session, onClose }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await copyText(session?.shareUrl);
    if (ok) {
      setCopied(true);
      toast.success("Player link copied");
    } else {
      toast.error("Couldn't copy — select the link and copy it by hand");
    }
  };

  const handleClose = () => {
    setCopied(false);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose();
      }}
    >
      <DialogContent className="sm:max-w-130">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarCheck className="w-4.5 h-4.5" />
            Session booked
          </DialogTitle>
          <DialogDescription>
            {session?.courtName}
            {session?.venueName && ` · ${session.venueName}`} —{" "}
            {formatDate(session?.startAt)},{" "}
            {formatTimeRange(session?.startAt, session?.endAt)}
          </DialogDescription>
        </DialogHeader>

        <div>
          <div
            className="mb-1.5"
            style={{ fontSize: 12.5, fontWeight: 500, color: "var(--color-text-secondary)" }}
          >
            Give {session?.playerName || "the player"} this link — the footage
            appears there in 5-minute parts as it is saved.
          </div>
          <div
            className="font-mono break-all select-all"
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
            {session?.shareUrl}
          </div>
        </div>

        <DialogFooter>
          <Button asChild variant="outline">
            <a href={session?.shareUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink />
              Open
            </a>
          </Button>
          <Button type="button" onClick={handleCopy}>
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SessionBookedDialog;
