import { Cloud, CloudOff, Loader2, RefreshCw, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import SetupSection from "./SetupSection";
import StatusDot from "../../../../../components/StatusDot";
import { confirm } from "../../../../../store/confirmStore";
import { formatDateTime } from "../../../../../utils/dynaCam";
import {
  useConnectCourtDrive,
  useDisconnectCourtDrive,
} from "../../../../../services/requests/admin/courts";

const muted = { fontSize: 13, color: "var(--color-text-secondary)" };

const Panel = ({ children }) => (
  <div
    className="px-3.5 py-3"
    aria-live="polite"
    style={{
      border: "1px solid var(--color-line)",
      borderRadius: 10,
      background: "var(--color-surface-sunken)",
    }}
  >
    {children}
  </div>
);

/** "3 waiting · 1 couldn't upload · last upload Nov 17, 2026 2:30 PM" */
const queueLine = (queue) => {
  if (!queue) return null;
  const parts = [];
  if (queue.waiting) parts.push(`${queue.waiting} waiting to upload`);
  if (queue.failed) parts.push(`${queue.failed} couldn't be uploaded`);
  parts.push(
    queue.lastUploadedAt
      ? `last upload ${formatDateTime(queue.lastUploadedAt)}`
      : "nothing uploaded yet",
  );
  return parts.join(" · ");
};

/**
 * CR-040: without a usable Drive, players get no video from this court — the
 * venue's recorder box keeps each game and sends it once Drive is connected.
 */
const NoVideoWarning = () => (
  <div
    className="flex items-start gap-2 px-3.5 py-3"
    role="status"
    style={{
      border: "1px solid var(--color-line)",
      borderRadius: 10,
      fontSize: 13,
      color: "var(--color-warning)",
    }}
  >
    <CloudOff className="w-4 h-4 shrink-0 mt-0.5" />
    <span>
      Players get no video from this court until Google Drive is connected. The venue&apos;s
      recorder box keeps each game for the venue&apos;s keep time and sends it to Drive once
      it&apos;s connected.
    </span>
  </div>
);

/**
 * CR-001 — the court's Google Drive: every recording on this court (replays
 * and whole games) is also copied to the connected account's Drive, and the
 * player's page links to it. Connect / change account / disconnect need
 * court setup write access; everyone who can open the page sees the status.
 */
const GoogleDriveSection = ({ court, canWrite }) => {
  const drive = court.googleDrive || {};
  const connectMutation = useConnectCourtDrive();
  const disconnectMutation = useDisconnectCourtDrive();
  const busy = connectMutation.isPending || disconnectMutation.isPending;
  const needsReconnect = drive.status === "NeedsReconnect";

  const handleConnect = async () => {
    try {
      const response = await connectMutation.mutateAsync(court.courtId);
      const url = response?.data?.url;
      // Google's consent screen; it sends the browser back to this page
      if (url) window.location.assign(url);
    } catch (error) {
      // the mutation's onError already surfaced a toast
      console.error("Connect Google Drive error:", error);
    }
  };

  const handleDisconnect = async () => {
    const ok = await confirm({
      title: "Disconnect Google Drive",
      description: `New recordings on this court stop going to ${drive.email || "this Google account"}. Videos already in that Drive stay there and their links keep working — DGSports can no longer delete them after the venue's keep time, so remove them in Drive yourself if needed.`,
      confirmText: "Disconnect",
      danger: true,
    });
    if (!ok) return;
    try {
      await disconnectMutation.mutateAsync(court.courtId);
    } catch (error) {
      console.error("Disconnect Google Drive error:", error);
    }
  };

  const connectIcon = connectMutation.isPending ? (
    <Loader2 className="animate-spin" />
  ) : (
    <Cloud />
  );

  let body;
  if (!drive.configured) {
    body = (
      <div className="space-y-3">
        <NoVideoWarning />
        <Panel>
          <StatusDot tone="muted">
            <span className="font-semibold" style={{ color: "var(--color-text-dark)" }}>
              Google Drive isn&apos;t available yet
            </span>
          </StatusDot>
          <div className="mt-1" style={muted}>
            It has to be turned on for DGSports once. After that, a Connect Google
            Drive button appears here.
          </div>
          <div className="mt-1" style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
            For the administrator: set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and
            GOOGLE_REDIRECT_URI in the API&apos;s .env (steps in back/.env.example), then
            restart the API.
          </div>
        </Panel>
      </div>
    );
  } else if (!drive.connected) {
    body = (
      <div className="space-y-3">
        <NoVideoWarning />
        {canWrite && (
          <Button type="button" className="h-10" onClick={handleConnect} disabled={busy}>
            {connectIcon}
            Connect Google Drive
          </Button>
        )}
      </div>
    );
  } else {
    const queue = queueLine(drive.queue);
    body = (
      <div className="space-y-4">
        <Panel>
          <StatusDot tone={needsReconnect ? "warning" : "success"}>
            <span className="font-semibold" style={{ color: "var(--color-text-dark)" }}>
              {needsReconnect ? "Needs reconnecting" : "Connected"}
            </span>
            <span className="break-all">· {drive.email || "Google account"}</span>
          </StatusDot>
          {needsReconnect && (
            <div className="mt-1" style={{ ...muted, color: "var(--color-warning)" }}>
              {drive.problem ||
                "Google refused the sign-in. Reconnect to resume uploads."}{" "}
              Players get no new video from this court until then: recordings
              made meanwhile stay on the venue&apos;s recorder box and are sent
              once it&apos;s reconnected, and expired videos leave the Drive then too.
            </div>
          )}
          {queue && (
            <div className="mt-1" style={muted}>
              {queue}
            </div>
          )}
          {drive.queue?.lastError && (drive.queue.waiting > 0 || drive.queue.failed > 0) && (
            <div className="mt-1" style={muted}>
              Last problem: {drive.queue.lastError}
            </div>
          )}
          {/* CR-017 / CR-026; CR-040: sent from the box, kept the venue's keep time */}
          <div className="mt-1" style={muted}>
            Each video&apos;s Drive copy is moved to the Drive&apos;s trash when the
            venue&apos;s keep time is over (Google empties the trash after 30 days).
            A week of games is about 35 GB per camera — the account needs that much
            Google storage.
          </div>
          {drive.connectedAt && (
            <div className="mt-1" style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
              Connected {formatDateTime(drive.connectedAt)}
            </div>
          )}
        </Panel>
        {canWrite && (
          <div className="flex items-center gap-2 flex-wrap">
            {needsReconnect ? (
              <Button type="button" className="h-10" onClick={handleConnect} disabled={busy}>
                {connectMutation.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                Reconnect
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="h-10"
                onClick={handleConnect}
                disabled={busy}
              >
                {connectIcon}
                Change account
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              className="h-10"
              onClick={handleDisconnect}
              disabled={busy}
            >
              {disconnectMutation.isPending ? <Loader2 className="animate-spin" /> : <Unplug />}
              Disconnect
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <SetupSection
      id="court-google-drive"
      title="Google Drive"
      description="Where players get their games: the venue's recorder box sends every game video and save on this court straight to this Google Drive, in a folder for this court, and players open it from an Open in Google Drive link on their page."
    >
      {body}
    </SetupSection>
  );
};

export default GoogleDriveSection;
