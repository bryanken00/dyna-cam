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
 * PLAN-008 phase B: a temporary password, shown ONCE (after onboarding a company,
 * adding a super admin, or a reset) — the API never returns it again. Props:
 * `{ open, onClose, email, password, welcomeSent?, title?, signInPath? }` — by
 * default it's a company Owner's (signs in at /admin); phase E's super admins pass
 * their own title and "/backoffice".
 */
const TemporaryPasswordDialog = ({
  open,
  onClose,
  email,
  password,
  welcomeSent,
  title = "The Owner's temporary password",
  signInPath = "/admin",
}) => {
  const handleCopy = async () => {
    const ok = await copyText(`Email: ${email}\nTemporary password: ${password}`);
    if (ok) toast.success("Copied");
    else toast.error("Couldn't copy — select the password instead");
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-125">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="w-5 h-5" />
            {title}
          </DialogTitle>
          <DialogDescription>
            Shown only now. Pass it on safely — they choose their own password when they first sign in at{" "}
            {signInPath}.
            {welcomeSent ? " It was also emailed to them." : ""}
          </DialogDescription>
        </DialogHeader>

        <div
          className="p-4 space-y-2"
          style={{ background: "var(--color-surface-sunken)", border: "1px solid var(--color-line)", borderRadius: 10 }}
        >
          <div style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>Email</div>
          <div className="break-all" style={{ fontSize: 14, color: "var(--color-text-dark)" }}>
            {email}
          </div>
          <div className="pt-1" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
            Temporary password
          </div>
          <div className="font-mono break-all select-all" style={{ fontSize: 16, fontWeight: 600, color: "var(--color-text-dark)" }}>
            {password}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleCopy}>
            <Copy />
            Copy
          </Button>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TemporaryPasswordDialog;
