/**
 * The list-table status cell: a 7px dot + label. `tone` picks the dot colour
 * from the status tokens; "success" also gets the soft glow the Modern status
 * column uses.
 *
 * tone: "success" | "warning" | "error" | "muted"
 */
const TONES = {
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  error: "var(--color-error)",
  muted: "var(--color-text-muted)",
};

const StatusDot = ({ tone = "muted", children, title }) => (
  <span
    className="inline-flex items-center gap-2"
    style={{ fontSize: 13, color: "var(--color-text-secondary)" }}
    title={title}
  >
    <span
      aria-hidden="true"
      style={{
        width: 7,
        height: 7,
        flex: "none",
        borderRadius: "50%",
        background: TONES[tone] || TONES.muted,
        boxShadow: tone === "success" ? "0 0 8px rgba(34,197,94,.5)" : "none",
      }}
    />
    {children}
  </span>
);

export default StatusDot;
