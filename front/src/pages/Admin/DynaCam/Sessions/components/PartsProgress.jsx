/** "3/12 parts" with a thin accent bar. */
const PartsProgress = ({ ready, total }) => {
  const pct = total > 0 ? Math.round((ready / total) * 100) : 0;
  return (
    <div className="min-w-0" style={{ width: 96 }}>
      <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
        {ready}/{total} parts
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

export default PartsProgress;
