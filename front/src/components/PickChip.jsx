/**
 * PLAN-003: a pickable chip on the player's booking pages — a date, a length,
 * a start time or a way to pay. Selected = darker border on the sunken surface.
 */
const PickChip = ({
  selected,
  disabled,
  onClick,
  children,
  label,
  className = "",
}) => (
  <button
    type="button"
    aria-pressed={selected}
    aria-label={label}
    disabled={disabled}
    onClick={onClick}
    className={`shrink-0 transition-colors disabled:cursor-not-allowed ${className}`}
    style={{
      borderRadius: 10,
      border: `1px solid ${selected ? "var(--color-text-dark)" : "var(--color-line)"}`,
      background: selected
        ? "var(--color-surface-sunken)"
        : "var(--color-surface)",
      color: disabled ? "var(--color-text-muted)" : "var(--color-text-dark)",
      opacity: disabled ? 0.55 : 1,
    }}
  >
    {children}
  </button>
);

export default PickChip;
