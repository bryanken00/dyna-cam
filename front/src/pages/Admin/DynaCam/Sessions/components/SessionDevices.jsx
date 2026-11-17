import { Clock, Smartphone, Unlink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import StatusDot from "../../../../../components/StatusDot";
import { confirm } from "../../../../../store/confirmStore";
import { decodeHTML } from "../../../../../utils/decode-html";
import { formatAgo } from "../../../../../utils/dynaCam";
import {
  useCancelSessionPairingCode,
  useUnpairSessionDevice,
} from "../../../../../services/requests/admin/sessions";

const PLATFORM_LABEL = { android: "Android", ios: "iOS", web: "Web" };

/** "android" → "Android"; unknown values pass through as sent. */
const platformLabel = (platform) =>
  PLATFORM_LABEL[String(platform || "").toLowerCase()] || platform || null;

/** 540 → "9 min", 42 → "42 s". */
const formatLeft = (seconds) => {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return s >= 60 ? `${Math.ceil(s / 60)} min` : `${s} s`;
};

const rowStyle = { borderTop: "1px solid var(--color-line)" };
const nameStyle = { fontSize: 13.5, fontWeight: 500, color: "var(--color-text-dark)" };
const metaStyle = { fontSize: 12.5, color: "var(--color-text-muted)" };

/**
 * A session's devices (PLAN-002 Phase E): the phones/tablets paired to it,
 * each with Unpair, and the keys still waiting to be typed in, each with
 * Cancel. Pairing is offered while the session is Scheduled or Recording.
 *
 * @param {object} session   GET /admin/sessions/:id → `session` (with
 *                           `devices` and `pairingCodes`)
 * @param {boolean} canWrite shows Pair / Unpair / Cancel
 * @param {(session) => void} onPairDevice
 */
const SessionDevices = ({ session, canWrite, onPairDevice }) => {
  const unpairMutation = useUnpairSessionDevice();
  const cancelKeyMutation = useCancelSessionPairingCode();

  const devices = session?.devices || [];
  const keys = session?.pairingCodes || [];
  const pairable = ["Scheduled", "Recording"].includes(session?.status);
  const activeCount = devices.filter((d) => d.status === "Active").length;

  const handleUnpair = async (device) => {
    const ok = await confirm({
      title: "Unpair device",
      description: `Unpair "${decodeHTML(device.name)}"? It stops showing this session right away and goes back to "Pair this device". Recording carries on.`,
      confirmText: "Unpair",
      cancelText: "Keep it",
      danger: true,
    });
    if (ok) {
      unpairMutation.mutate({
        sessionId: session.sessionId,
        pairedAppId: device.pairedAppId,
      });
    }
  };

  const handleCancelKey = async (key) => {
    const ok = await confirm({
      title: "Cancel pairing key",
      description: `Cancel the key for "${decodeHTML(key.name)}"? It stops working right away.`,
      confirmText: "Cancel key",
      cancelText: "Keep it",
      danger: true,
    });
    if (ok) {
      cancelKeyMutation.mutate({
        sessionId: session.sessionId,
        pairingCodeId: key.pairingCodeId,
      });
    }
  };

  return (
    <div
      className="mt-6 overflow-hidden"
      style={{ border: "1px solid var(--color-line)", borderRadius: 10 }}
    >
      <div
        className="flex items-center justify-between gap-3 px-3.5 py-2"
        style={{ background: "var(--color-surface-sunken)" }}
      >
        <span
          className="uppercase"
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.08em",
            color: "var(--color-text-muted)",
          }}
        >
          Devices{activeCount > 0 ? ` · ${activeCount}` : ""}
        </span>
        {canWrite && pairable && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onPairDevice?.(session)}
          >
            <Smartphone />
            Pair a device
          </Button>
        )}
      </div>

      {devices.map((device) => {
        const active = device.status === "Active";
        const meta = [
          platformLabel(device.platform),
          device.appVersion ? `v${device.appVersion}` : null,
          device.lastSeenSecondsAgo === null || device.lastSeenSecondsAgo === undefined
            ? "not seen yet"
            : `last seen ${formatAgo(Number(device.lastSeenSecondsAgo))}`,
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <div
            key={device.pairedAppId}
            className="flex items-center gap-3 flex-wrap p-3.5"
            style={rowStyle}
          >
            <Smartphone
              className="w-4 h-4 shrink-0"
              style={{ color: "var(--color-text-muted)" }}
            />
            <div className="flex-1 min-w-0">
              <div className="truncate" style={nameStyle}>
                {decodeHTML(device.name)}
              </div>
              <div className="truncate" style={metaStyle}>
                {meta}
              </div>
            </div>
            <StatusDot tone={active ? "success" : "muted"}>{device.status}</StatusDot>
            {canWrite && active && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={unpairMutation.isPending}
                onClick={() => handleUnpair(device)}
              >
                <Unlink />
                Unpair
              </Button>
            )}
          </div>
        );
      })}

      {keys.map((key) => (
        <div
          key={key.pairingCodeId}
          className="flex items-center gap-3 flex-wrap p-3.5"
          style={rowStyle}
        >
          <Clock
            className="w-4 h-4 shrink-0"
            style={{ color: "var(--color-warning)" }}
          />
          <div className="flex-1 min-w-0">
            <div className="truncate" style={nameStyle}>
              {decodeHTML(key.name)}
            </div>
            <div style={metaStyle}>
              Waiting to pair · key expires in {formatLeft(key.expiresInSeconds)}
            </div>
          </div>
          {canWrite && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={cancelKeyMutation.isPending}
              onClick={() => handleCancelKey(key)}
            >
              <X />
              Cancel
            </Button>
          )}
        </div>
      ))}

      {devices.length === 0 && keys.length === 0 && (
        <p className="m-0 p-3.5" style={{ ...rowStyle, fontSize: 13, color: "var(--color-text-muted)" }}>
          {pairable
            ? "No device paired yet. Pair the phone or tablet at the court to show this session live, with the player's download QR."
            : "No device was paired to this session."}
        </p>
      )}
    </div>
  );
};

export default SessionDevices;
