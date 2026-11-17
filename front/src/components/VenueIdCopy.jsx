import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { copyText } from "../utils/clipboard";

/**
 * A venue's ID in small monospace with a Copy button — what a recorder box
 * needs as `VENUE_ID` in its `.env` to enrol (PLAN-002 Phase I).
 *
 * @param {string} venueId
 */
const VenueIdCopy = ({ venueId }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await copyText(venueId);
    if (ok) {
      setCopied(true);
      toast.success("Venue ID copied");
    } else {
      toast.error("Couldn't copy — select the ID and copy it by hand");
    }
  };

  if (!venueId) return null;

  return (
    <span className="inline-flex items-center gap-2 max-w-full min-w-0">
      <code
        className="font-mono select-all truncate min-w-0"
        title={venueId}
        style={{
          fontSize: 12,
          padding: "3px 8px",
          borderRadius: 6,
          border: "1px solid var(--color-line)",
          background: "var(--color-surface-sunken)",
          color: "var(--color-text-dark)",
        }}
      >
        {venueId}
      </code>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 shrink-0"
        onClick={handleCopy}
        aria-label="Copy venue ID"
      >
        {copied ? <Check /> : <Copy />}
        Copy
      </Button>
    </span>
  );
};

export default VenueIdCopy;
