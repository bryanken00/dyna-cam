import { ChevronDown, Copy, ExternalLink, Power, RefreshCcw, Tv } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * CR-038: the picked venue's TV court board link, from the Bookings toolbar —
 * a public page to open on a TV at the venue (today's courts, no names or
 * booking codes). On: open, copy, and (write) issue a new link or turn it off.
 * Off: turn it on (write); read-only staff see nothing to do.
 */
const TvBoardMenu = ({ displayUrl, canWrite, busy, onIssue, onTurnOff, onCopy }) => {
  if (!displayUrl) {
    return canWrite ? (
      <Button type="button" variant="outline" size="sm" onClick={onIssue} disabled={busy}>
        <Tv />
        Turn on TV board
      </Button>
    ) : null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={busy}>
          <Tv />
          TV board
          <ChevronDown className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
          Open this on a TV at the venue: today&apos;s courts, no names or booking codes.
        </DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <a href={displayUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink />
            Open board
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onCopy}>
          <Copy />
          Copy link
        </DropdownMenuItem>
        {canWrite && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onIssue}>
              <RefreshCcw />
              Issue new link
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onTurnOff}>
              <Power />
              Turn off
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default TvBoardMenu;
