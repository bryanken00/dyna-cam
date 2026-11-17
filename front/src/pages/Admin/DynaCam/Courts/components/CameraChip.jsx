import { Video, VideoOff } from "lucide-react";

/** Camera column chip: set (with the credential-free address) or not. */
const CameraChip = ({ camera }) => {
  const configured = !!camera?.configured;
  const Icon = configured ? Video : VideoOff;
  return (
    <div className="min-w-0">
      <span
        className="inline-flex items-center gap-1.5"
        style={{
          fontSize: 12,
          fontWeight: 500,
          padding: "2px 9px",
          borderRadius: 999,
          border: "1px solid var(--color-line)",
          background: "var(--color-surface-sunken)",
          color: configured
            ? "var(--color-text-dark)"
            : "var(--color-text-muted)",
        }}
      >
        <Icon
          className="w-3.5 h-3.5"
          style={{
            color: configured
              ? "var(--color-secondary-color)"
              : "var(--color-text-muted)",
          }}
        />
        {configured ? "Camera set" : "No camera"}
      </span>
      {configured && (
        <div
          className="font-mono truncate mt-1"
          style={{ fontSize: 11.5, color: "var(--color-text-muted)" }}
          title={camera.display || undefined}
        >
          {camera.display || "Unreadable — enter it again"}
        </div>
      )}
    </div>
  );
};

export default CameraChip;
