import { Copy, PlugZap, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * PLAN-008 phase C: the company's own Xendit account on the Payments page —
 * connected or not, test or live, and the webhook URL to paste into Xendit.
 * Props: `{ payment, canWrite, onConnect, onDisconnect, onCopyWebhook, isDisconnecting }`.
 */
const OnlinePaymentCard = ({ payment, canWrite, onConnect, onDisconnect, onCopyWebhook, isDisconnecting }) => {
  if (!payment) return null;
  const { source, connected, mode, webhookUrl, sandbox } = payment;

  const status = sandbox
    ? "Test checkout on this server — no real money moves"
    : source === "company"
      ? `Connected · ${mode === "live" ? "live" : "test mode"}`
      : source === "env"
        ? "Using the server's Xendit keys — connect your own to get paid into your account"
        : "Not connected — players can't book online until you connect Xendit";

  return (
    <div
      className="p-4 sm:p-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
      style={{ borderRadius: 14, border: "1px solid var(--color-line)", background: "var(--color-surface-raised)" }}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2" style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-dark)" }}>
          <PlugZap className="size-4.5" style={{ color: connected ? "var(--color-success)" : "var(--color-warning)" }} />
          Online payment (Xendit)
        </div>
        <div className="mt-0.5" style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
          {status}
        </div>
        {source === "company" && webhookUrl && (
          <div className="mt-2 flex items-center gap-2 min-w-0" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
            <span className="shrink-0">Webhook URL for Xendit:</span>
            <code className="truncate" style={{ fontFamily: "var(--font-mono)" }}>
              {webhookUrl}
            </code>
            <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0" onClick={onCopyWebhook} aria-label="Copy the webhook URL">
              <Copy className="size-3.5" />
            </Button>
          </div>
        )}
      </div>
      {canWrite && (
        <div className="flex gap-2 shrink-0">
          {source === "company" && (
            <Button type="button" variant="outline" size="sm" onClick={onDisconnect} disabled={isDisconnecting}>
              <Unplug />
              Disconnect
            </Button>
          )}
          <Button type="button" size="sm" onClick={onConnect}>
            <PlugZap />
            {source === "company" ? "Replace keys" : "Connect Xendit"}
          </Button>
        </div>
      )}
    </div>
  );
};

export default OnlinePaymentCard;
