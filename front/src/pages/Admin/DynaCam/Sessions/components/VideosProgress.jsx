/**
 * CR-006: a game's whole videos (one per camera) — "1/2 videos" with a thin
 * accent bar, or what's happening before they exist.
 */
const VideosProgress = ({ ready, total, status }) => {
  if (["Waiting", "Scheduled", "Recording", "Cancelled"].includes(status) || total === 0) {
    return (
      <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
        {status === "Recording" ? "Recording…" : "—"}
      </span>
    );
  }
  if (status === "Processing") {
    return <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>Saving…</span>;
  }
  const pct = total > 0 ? Math.round((ready / total) * 100) : 0;
  return (
    <div className="min-w-0" style={{ width: 96 }}>
      <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
        {ready}/{total} {total === 1 ? "video" : "videos"}
      </div>
      <div
        className="mt-1 overflow-hidden"
        style={{
          height: 4,
          borderRadius: 999,
          background: "var(--color-surface-sunken)",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            borderRadius: 999,
            background: "var(--color-secondary-color)",
          }}
        />
      </div>
    </div>
  );
};

export default VideosProgress;
