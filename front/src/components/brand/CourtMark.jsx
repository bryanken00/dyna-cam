/** The logo mark: a court from above — white lines, lime kitchen. Sits on the blue and navy bands. */
const CourtMark = () => (
  <svg viewBox="0 0 24 16" className="w-6 h-4" aria-hidden="true">
    <rect
      x="1"
      y="1"
      width="22"
      height="14"
      rx="2"
      style={{ fill: "none", stroke: "var(--color-brand-on-court)", strokeWidth: 1.6 }}
    />
    <rect x="8.5" y="1.8" width="7" height="12.4" style={{ fill: "var(--color-brand-ball)" }} />
    <line
      x1="12"
      y1="0"
      x2="12"
      y2="16"
      style={{ stroke: "var(--color-brand-on-court)", strokeWidth: 1.6 }}
    />
  </svg>
);

export default CourtMark;
