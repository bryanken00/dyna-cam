/** Small "Live" pill (red dot) for a court that streams. */
const LiveChip = ({ title }) => (
  <span
    className="inline-flex items-center gap-1.5 shrink-0"
    title={title || "Streams live"}
    style={{
      fontSize: 11.5,
      fontWeight: 500,
      padding: "1px 8px",
      borderRadius: 999,
      border: "1px solid var(--color-line)",
      background: "var(--color-surface-sunken)",
      color: "var(--color-text-dark)",
    }}
  >
    <span
      aria-hidden="true"
      style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: "var(--color-error)",
      }}
    />
    Live
  </span>
);

export default LiveChip;
