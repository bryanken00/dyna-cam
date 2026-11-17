import { Smartphone } from "lucide-react";

/**
 * The small "2 devices" line under a session's status. While the session can
 * still take a device (Scheduled / Recording) "No device" says one is
 * missing; afterwards a zero count shows nothing.
 */
const DevicesCount = ({ count, live }) => {
  if (count <= 0 && !live) return null;
  return (
    <div
      className="flex items-center gap-1.5 mt-0.5 whitespace-nowrap"
      style={{ fontSize: 12, color: "var(--color-text-muted)" }}
    >
      <Smartphone className="w-3.5 h-3.5" strokeWidth={1.8} />
      {count > 0 ? `${count} ${count === 1 ? "device" : "devices"}` : "No device"}
    </div>
  );
};

export default DevicesCount;
