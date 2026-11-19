/**
 * A pickleball court from above for the court board, painted like the brand
 * court on the landing page (CR-011): deep-blue playing area, kitchens a shade
 * lighter, white lines. To scale: 44 × 20 ft, a 7 ft kitchen each side of the
 * net, a centre line from each baseline to its kitchen. The court's state:
 *
 *   playing  → lime outline and net, the lime ball crossing the court
 *   waiting  → dashed lime outline (a game is set up, no device yet)
 *   idle     → white lines only
 *
 * Each configured camera sits behind its baseline (Cam 1 left, Cam 2 right) as
 * a dot in its status colour with a white ring. Brand colours are constant
 * across light and dark.
 */

const CAMERA_COLOUR = {
  ok: "var(--color-success)",
  starting: "var(--color-warning)",
  error: "var(--color-error)",
  offline: "var(--color-error)",
  unknown: "var(--color-text-muted)",
};

// Court units are feet; 3 ft of run-off each end for the camera markers
const W = 44;
const H = 20;
const PAD = 3;

const WHITE = "var(--color-brand-on-court)";
const BALL = "var(--color-brand-ball)";

const CourtDiagram = ({ state = "idle", cameras = [], label }) => {
  const active = state === "playing" || state === "waiting";
  const stroke = { vectorEffect: "non-scaling-stroke" };
  const line = { stroke: WHITE, strokeWidth: 1.25, fill: "none", opacity: 0.85, ...stroke };

  return (
    <svg
      viewBox={`${-PAD} -1 ${W + PAD * 2} ${H + 2}`}
      className="block w-full h-auto"
      role="img"
      aria-label={label}
    >
      {/* Playing area + kitchens */}
      <rect x={0} y={0} width={W} height={H} style={{ fill: "var(--color-brand-court-deep)" }} />
      <rect
        x={15}
        y={0}
        width={14}
        height={H}
        style={{ fill: "var(--color-brand-court-light)", opacity: 0.55 }}
      />

      {/* Kitchen lines and centre lines */}
      <line x1={15} y1={0} x2={15} y2={H} style={line} />
      <line x1={29} y1={0} x2={29} y2={H} style={line} />
      <line x1={0} y1={H / 2} x2={15} y2={H / 2} style={line} />
      <line x1={29} y1={H / 2} x2={W} y2={H / 2} style={line} />

      {/* Outline: lime while a game is on (dashed while it waits for a device) */}
      <rect
        x={0}
        y={0}
        width={W}
        height={H}
        style={{
          fill: "none",
          stroke: active ? BALL : WHITE,
          strokeWidth: active ? 2.25 : 1.5,
          strokeDasharray: state === "waiting" ? "4 3" : undefined,
          ...stroke,
        }}
      />

      {/* Net */}
      <line
        x1={W / 2}
        y1={-0.6}
        x2={W / 2}
        y2={H + 0.6}
        style={{ stroke: state === "playing" ? BALL : WHITE, strokeWidth: 2, ...stroke }}
      />

      {/* The ball, while a game is on */}
      {state === "playing" && (
        <circle
          cx={16}
          cy={6.5}
          r={1}
          className="court-rally"
          style={{ fill: BALL, stroke: "var(--color-brand-ink)", strokeWidth: 0.6, ...stroke }}
        />
      )}

      {/* Cameras behind the baselines */}
      {cameras.map(({ camera, status }) => (
        <circle
          key={camera}
          cx={camera === 2 ? W + PAD / 2 : -PAD / 2}
          cy={H / 2}
          r={1.05}
          style={{
            fill: CAMERA_COLOUR[status] || CAMERA_COLOUR.unknown,
            stroke: "var(--color-surface)",
            strokeWidth: 1.5,
            ...stroke,
          }}
        >
          <title>{`Cam ${camera}: ${status}`}</title>
        </circle>
      ))}
    </svg>
  );
};

export default CourtDiagram;
