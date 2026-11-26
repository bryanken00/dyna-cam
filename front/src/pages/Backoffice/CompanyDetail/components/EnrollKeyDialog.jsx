import { Copy, KeyRound } from "lucide-react";
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

import { copyText } from "../../../../utils/clipboard";

/**
 * A suggestion for the box's API_URL: this site's address (the web app reaches the API
 * through the same origin's /api). The box wants the base address without /api.
 */
const apiUrl = () => window.location.origin.replace(/\/+$/, "");

const Step = ({ n, children }) => (
  <li className="flex gap-3">
    <span
      className="inline-flex items-center justify-center shrink-0 font-mono"
      style={{
        width: 22,
        height: 22,
        borderRadius: 6,
        fontSize: 12,
        border: "1px solid var(--color-line)",
        color: "var(--color-text-secondary)",
      }}
    >
      {n}
    </span>
    <span style={{ fontSize: 13.5, color: "var(--color-text-dark)", lineHeight: 1.5 }}>{children}</span>
  </li>
);

const Code = ({ children }) => (
  <code
    className="font-mono px-1 py-0.5 break-all"
    style={{ fontSize: 12.5, borderRadius: 4, background: "var(--color-surface-sunken)" }}
  >
    {children}
  </code>
);

/**
 * PLAN-008 phase F: a company's new recorder-box enroll key, shown ONCE (only its hash
 * is kept), with Copy and how to set a box up with it. Props: `{ open, onClose, enrollKey }`.
 */
const EnrollKeyDialog = ({ open, onClose, enrollKey }) => {
  const handleCopy = async () => {
    const ok = await copyText(enrollKey || "");
    if (ok) toast.success("Key copied");
    else toast.error("Couldn't copy — select the key instead");
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-140">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="w-5 h-5" />
            The box enroll key
          </DialogTitle>
          <DialogDescription>
            Shown only now — copy it. Anyone with it can enrol a box into this company&apos;s venues, so keep it to the
            people setting boxes up.
          </DialogDescription>
        </DialogHeader>

        <div
          className="p-4 font-mono break-all select-all"
          style={{
            fontSize: 15,
            fontWeight: 600,
            background: "var(--color-surface-sunken)",
            border: "1px solid var(--color-line)",
            borderRadius: 10,
            color: "var(--color-text-dark)",
          }}
        >
          {enrollKey}
        </div>

        <ol className="m-0 p-0 list-none space-y-2.5">
          <Step n={1}>
            The company&apos;s Owner adds the venue in Admin → Setup → Venues and copies its <b>Venue ID</b>.
          </Step>
          <Step n={2}>
            On the box, in <Code>edge/.env</Code>: <Code>API_URL=</Code> the API&apos;s public address without{" "}
            <Code>/api</Code> (e.g. <Code>{apiUrl()}</Code>), <Code>ENROLL_KEY=</Code> this key, and <Code>VENUE_ID=</Code>{" "}
            the venue&apos;s ID.
          </Step>
          <Step n={3}>
            Start the box. It enrols once and gets its own device token; you can then remove <Code>ENROLL_KEY</Code>{" "}
            from its <Code>.env</Code>. It shows up in this company&apos;s boxes below.
          </Step>
        </ol>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleCopy}>
            <Copy />
            Copy key
          </Button>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EnrollKeyDialog;
