/** "① Camera type" — a numbered step heading inside the guided camera setup. */
const StepLabel = ({ n, children, done = false }) => (
  <div className="flex items-center gap-2.5 mb-3">
    <span
      className="inline-flex items-center justify-center shrink-0 font-semibold"
      style={{
        width: 22,
        height: 22,
        borderRadius: 999,
        fontSize: 12,
        border: "1px solid var(--color-line)",
        background: done ? "var(--color-secondary-color)" : "var(--color-surface-sunken)",
        color: done ? "var(--color-btn-text)" : "var(--color-text-secondary)",
      }}
    >
      {n}
    </span>
    <span
      className="font-semibold"
      style={{ fontSize: 14, color: "var(--color-text-dark)" }}
    >
      {children}
    </span>
  </div>
);

export default StepLabel;
