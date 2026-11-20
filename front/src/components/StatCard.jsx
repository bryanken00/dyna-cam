import { memo } from "react";

/**
 * Stat card — de-emphasized label + dim icon on the top row, big value + unit
 * below. Flat by design: hairline border, radius 14, no shadow, no gradient bar.
 *
 * @param {string} title  - the de-emphasized label
 * @param {string|number} value
 * @param {string} [change] - the unit / caption sitting next to the value
 * @param {ReactNode} [icon] - a lucide icon; court blue on a soft blue tile
 */
const StatCard = ({ title, value, change, icon }) => (
  <div
    // h-full: cards in one grid row are the same height
    className="theme-transition h-full"
    style={{
      background: "var(--color-surface)",
      border: "1px solid var(--color-line)",
      borderRadius: "var(--radius-card)",
      padding: "16px 18px",
    }}
  >
    <div className="flex items-center justify-between gap-3">
      <span
        className="truncate"
        style={{ fontSize: 12.5, color: "var(--color-text-secondary)" }}
      >
        {title}
      </span>
      {icon && (
        <span
          className="shrink-0 inline-flex items-center justify-center"
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            // Court blue on a tint of itself (CR-011) — `--color-link` lifts in dark
            color: "var(--color-link)",
            background: "color-mix(in srgb, var(--color-link) 12%, transparent)",
          }}
        >
          {icon}
        </span>
      )}
    </div>

    {/* The value never breaks; the caption moves under it when there's no room */}
    <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 mt-2.5">
      <span
        className="whitespace-nowrap"
        style={{
          fontSize: 30,
          fontWeight: 600,
          lineHeight: 1.1,
          letterSpacing: "-0.5px",
          color: "var(--color-text-dark)",
        }}
      >
        {value}
      </span>
      {change && (
        <span className="min-w-0" style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
          {change}
        </span>
      )}
    </div>
  </div>
);

// Memoized: stat values rarely change, but parent pages re-render on every
// keystroke (search/filter state). React.memo skips re-render when props are equal.
export default memo(StatCard);
