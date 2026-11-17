import { Clock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirm } from "../store/confirmStore";
import { decodeHTML } from "../utils/decode-html";
import { formatDateTime } from "../utils/dynaCam";
import {
  useCancelPairingCode,
  useGetPairingCodes,
} from "../services/requests/admin/pairing-codes";

/**
 * "Waiting to pair": keys created but not used yet (their digits are never
 * shown again), each with Cancel. Renders nothing when there are none.
 *
 * @param {"apps"|"recorders"} kind
 * @param {boolean} canWrite   shows Cancel
 * @param {number} [refetchInterval]  faster while a key dialog is open; by
 *        default once a minute so expired keys drop off
 */
const PendingPairingKeys = ({ kind, canWrite, refetchInterval = 60 * 1000 }) => {
  const { data } = useGetPairingCodes(kind, { refetchInterval });
  const cancelMutation = useCancelPairingCode(kind);
  const keys = data?.data?.pairingCodes || [];

  if (keys.length === 0) return null;

  const handleCancel = async (key) => {
    const ok = await confirm({
      title: "Cancel pairing key",
      description: `Cancel the key for "${decodeHTML(key.name)}"? It stops working right away.`,
      confirmText: "Cancel key",
      cancelText: "Keep it",
      danger: true,
    });
    if (ok) cancelMutation.mutate(key.pairingCodeId);
  };

  return (
    <div
      className="overflow-hidden"
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-line)",
        borderRadius: "var(--radius-card)",
      }}
    >
      <div
        className="px-4.5 py-3 uppercase"
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.08em",
          color: "var(--color-text-muted)",
          borderBottom: "1px solid var(--color-line)",
        }}
      >
        Waiting to pair · {keys.length}
      </div>
      {keys.map((key, i) => (
        <div
          key={key.pairingCodeId}
          className="flex items-center gap-3 flex-wrap px-4.5 py-3"
          style={{ borderTop: i === 0 ? "none" : "1px solid var(--color-line-soft)" }}
        >
          <Clock className="w-4 h-4 shrink-0" style={{ color: "var(--color-warning)" }} />
          <div className="flex-1 min-w-0">
            <div
              className="truncate"
              style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-dark)" }}
            >
              {decodeHTML(key.name)}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
              {decodeHTML(key.venueName)} · key expires {formatDateTime(key.expiresAt)}
            </div>
          </div>
          {canWrite && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleCancel(key)}
              disabled={cancelMutation.isPending}
            >
              <X />
              Cancel
            </Button>
          )}
        </div>
      ))}
    </div>
  );
};

export default PendingPairingKeys;
