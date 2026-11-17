import { Link } from "react-router";
import { CircleCheck, Image as ImageIcon, Info, Loader2, Server } from "lucide-react";
import StatusDot from "../../../../../components/StatusDot";
import { getImageUrl } from "../../../../../utils/upload";
import {
  RECORDER_BOXES_PATH,
  cameraFixHint,
  cameraHealth,
  formatAgo,
  formatStreamDetails,
} from "../../../../../utils/dynaCam";

const noticeStyle = {
  border: "1px solid var(--color-line)",
  borderRadius: 10,
  background: "var(--color-surface-sunken)",
  fontSize: 13.5,
  color: "var(--color-text-dark)",
};

/**
 * Step 3 of the camera setup: what the venue's recorder box sees from this
 * camera — status with a fix hint, resolution · fps · codecs, and the latest
 * preview picture with its age.
 *
 * Ages ("12 s ago") come from the server (`reportedSecondsAgo`,
 * `snapshotSecondsAgo`), refreshed with each poll.
 *
 * @param {object}  camera     the court's `camera` (configured, version, live, snapshotUrl, …)
 * @param {boolean} checking   a camera was just saved; still watching closely
 * @param {boolean} justSaved  a camera was saved on this visit
 * @param {boolean} [showNextSteps]  "The camera works. Next: …" (camera 1 only)
 * @param {string}  [previewAlt]     alt text of the preview picture
 */
const CameraLiveCheck = ({
  camera,
  checking,
  justSaved,
  showNextSteps = true,
  previewAlt = "Latest preview from the court camera",
}) => {
  const live = camera?.live || null;
  const health = cameraHealth(camera);
  // The box's report is about the current address only when the versions
  // match — until then it still describes the previous camera
  const switched = !live || live.cameraVersion === camera?.version;
  const boxUp = health.key !== "nobox";
  const waiting = boxUp && !switched && checking;
  const notSwitchedYet = boxUp && !switched && !checking;
  const hint = health.key === "error" && switched ? cameraFixHint(health.message) : null;
  const details = switched ? formatStreamDetails(live) : null;
  const snapshot = getImageUrl(camera?.snapshotUrl);
  const snapshotAge = camera?.snapshotSecondsAgo ?? null;

  return (
    <div className="space-y-4">
      {/* Status */}
      {health.key === "nobox" ? (
        <div className="flex items-start gap-2.5 px-3.5 py-3" style={noticeStyle}>
          <Server className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "var(--color-warning)" }} />
          <span>
            <strong className="font-semibold">
              No recorder box is online for this venue
            </strong>{" "}
            — set one up in{" "}
            <Link
              to={RECORDER_BOXES_PATH}
              className="hover:underline"
              style={{ color: "var(--color-link)" }}
            >
              Recorder Boxes
            </Link>
            . The camera can only be checked through the venue&apos;s box.
          </span>
        </div>
      ) : waiting ? (
        <div className="flex items-start gap-2.5 px-3.5 py-3" style={noticeStyle} aria-live="polite">
          <Loader2
            className="w-4 h-4 mt-0.5 shrink-0 animate-spin"
            style={{ color: "var(--color-secondary-color)" }}
          />
          <span>
            <strong className="font-semibold">
              Waiting for the recorder box to switch to the new camera…
            </strong>{" "}
            It picks up changes within a minute (about 15 seconds while this page
            is open), then reports what it sees here.
          </span>
        </div>
      ) : notSwitchedYet ? (
        <div className="flex items-start gap-2.5 px-3.5 py-3" style={noticeStyle}>
          <Info className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "var(--color-warning)" }} />
          <span>
            The recorder box hasn&apos;t switched to this camera address yet —
            the status it last reported is about the previous one. Check the box
            is online in{" "}
            <Link
              to={RECORDER_BOXES_PATH}
              className="hover:underline"
              style={{ color: "var(--color-link)" }}
            >
              Recorder Boxes
            </Link>
            ; this page keeps checking.
          </span>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <StatusDot tone={health.tone}>
              <span className="font-semibold" style={{ color: "var(--color-text-dark)" }}>
                {health.label}
              </span>
            </StatusDot>
            {health.message && health.key !== "ok" && (
              <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                {health.message}
              </span>
            )}
          </div>
          {hint && (
            <div className="flex items-start gap-2.5 px-3.5 py-3" style={noticeStyle}>
              <Info className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "var(--color-text-muted)" }} />
              <span>{hint}</span>
            </div>
          )}
          {health.key === "ok" && justSaved && showNextSteps && (
            <p
              className="m-0 inline-flex items-center gap-1.5"
              style={{ fontSize: 13, color: "var(--color-text-secondary)" }}
            >
              <CircleCheck className="w-4 h-4" style={{ color: "var(--color-success)" }} />
              The camera works. Next: print the{" "}
              <a href="#court-qr" className="hover:underline" style={{ color: "var(--color-link)" }}>
                QR sign
              </a>
              , and optionally set a{" "}
              <a href="#court-button" className="hover:underline" style={{ color: "var(--color-link)" }}>
                button
              </a>
              .
            </p>
          )}
        </div>
      )}

      {/* What the box receives (only once it's about the current address) */}
      {live && switched && (
        <div
          className="flex items-center justify-between gap-3 flex-wrap px-3.5 py-2.5"
          style={{ border: "1px solid var(--color-line)", borderRadius: 10 }}
        >
          <span
            className="font-mono"
            style={{ fontSize: 12.5, color: "var(--color-text-dark)" }}
          >
            {details || "No video details reported yet"}
          </span>
          {live.reportedSecondsAgo != null && (
            <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
              reported {formatAgo(live.reportedSecondsAgo)}
            </span>
          )}
        </div>
      )}

      {/* Preview picture */}
      <figure className="m-0">
        <div
          className="relative w-full overflow-hidden flex items-center justify-center"
          style={{
            aspectRatio: "16 / 9",
            borderRadius: 12,
            border: "1px solid var(--color-line)",
            background: "var(--color-surface-sunken)",
          }}
        >
          {snapshot ? (
            <img
              key={snapshot}
              src={snapshot}
              alt={previewAlt}
              className="w-full h-full object-contain"
            />
          ) : (
            <div
              className="flex flex-col items-center gap-2 px-6 text-center"
              style={{ fontSize: 13, color: "var(--color-text-muted)" }}
            >
              <ImageIcon className="w-6 h-6" strokeWidth={1.6} />
              The preview picture appears here — the recorder box sends one
              every 30 seconds while this page is open.
            </div>
          )}
        </div>
        {snapshot && (
          <figcaption
            className="mt-1.5"
            style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}
          >
            {live?.boxName ? `Preview from ${live.boxName}` : "Preview"}
            {snapshotAge !== null && ` · ${formatAgo(snapshotAge)}`}
            {" · use it to aim the camera"}
          </figcaption>
        )}
      </figure>
    </div>
  );
};

export default CameraLiveCheck;
