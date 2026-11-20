/**
 * The brand court (landing page hero, staff sign-in): a pickleball court from above, to scale (44 × 20 ft,
 * 7 ft kitchens; 10 units = 1 ft), painted like a real court on the blue band —
 * deep-blue playing area, white lines, a lime ball. Cam 1 and Cam 2 sit behind
 * the baselines. A rally is drawn once on load (a shot from the far baseline
 * that lands in the kitchen, with a speed trail like the venue's wall art),
 * and under it the game it ends up in (CR-027: the whole game, from Start game).
 *
 * Brand colours (index.css `--color-brand-*`) are constant across light and
 * dark: the band is always blue. Motion is CSS (`.landing-*`), so the
 * reduce-motion rule stops it.
 */

const COURT_W = 440;
const COURT_H = 200;
const KITCHEN = 70; // 7 ft
const NET_X = COURT_W / 2;

const WHITE = "var(--color-brand-on-court)";
const BALL = "var(--color-brand-ball)";

const line = { stroke: WHITE, strokeWidth: 2.5, fill: "none" };
const label = {
  fill: WHITE,
  opacity: 0.7,
  fontSize: 11,
  fontFamily: "var(--font-sans)",
};

const Camera = ({ x, side, name }) => (
  <g>
    <rect
      x={x}
      y={COURT_H / 2 - 12}
      width={30}
      height={24}
      rx={6}
      style={{ fill: WHITE }}
    />
    <circle
      cx={side === "left" ? x + 30 : x}
      cy={COURT_H / 2}
      r={5.5}
      style={{ fill: "var(--color-brand-ink)", stroke: WHITE, strokeWidth: 1.5 }}
    />
    <circle
      cx={x + 15}
      cy={COURT_H / 2 - 4}
      r={3.2}
      className="landing-rec"
      style={{ fill: "var(--color-brand-flame)" }}
    />
    <text x={x + 15} y={COURT_H / 2 + 30} textAnchor="middle" style={label}>
      {name}
    </text>
  </g>
);

const HeroCourt = () => (
  <svg
    viewBox="-62 -24 564 248"
    className="block w-full h-auto"
    role="img"
    aria-label="A blue pickleball court from above with a camera behind each baseline. A shot from the far baseline lands in the kitchen."
  >
    {/* Playing area, kitchens a shade lighter */}
    <rect
      x={0}
      y={0}
      width={COURT_W}
      height={COURT_H}
      style={{ fill: "var(--color-brand-court-deep)" }}
    />
    <rect
      x={NET_X - KITCHEN}
      y={0}
      width={KITCHEN * 2}
      height={COURT_H}
      style={{ fill: "var(--color-brand-court-light)", opacity: 0.55 }}
    />

    {/* White lines: kitchen lines, centre lines, outline */}
    <line x1={NET_X - KITCHEN} y1={0} x2={NET_X - KITCHEN} y2={COURT_H} style={line} />
    <line x1={NET_X + KITCHEN} y1={0} x2={NET_X + KITCHEN} y2={COURT_H} style={line} />
    <line x1={0} y1={COURT_H / 2} x2={NET_X - KITCHEN} y2={COURT_H / 2} style={line} />
    <line x1={NET_X + KITCHEN} y1={COURT_H / 2} x2={COURT_W} y2={COURT_H / 2} style={line} />
    <rect x={0} y={0} width={COURT_W} height={COURT_H} style={{ ...line, strokeWidth: 3 }} />

    {/* Net and posts */}
    <line
      x1={NET_X}
      y1={-9}
      x2={NET_X}
      y2={COURT_H + 9}
      style={{ stroke: WHITE, strokeWidth: 3.5 }}
    />
    <circle cx={NET_X} cy={-9} r={4} style={{ fill: "var(--color-brand-ink)", stroke: WHITE, strokeWidth: 1.5 }} />
    <circle
      cx={NET_X}
      cy={COURT_H + 9}
      r={4}
      style={{ fill: "var(--color-brand-ink)", stroke: WHITE, strokeWidth: 1.5 }}
    />

    <text x={NET_X - KITCHEN / 2} y={COURT_H - 10} textAnchor="middle" style={label}>
      Kitchen
    </text>
    <text x={NET_X + KITCHEN / 2} y={COURT_H - 10} textAnchor="middle" style={label}>
      Kitchen
    </text>

    {/* The rally: from the far baseline, over the net, into the kitchen */}
    <circle cx={392} cy={150} r={4} style={{ fill: WHITE, opacity: 0.6 }} />
    <path
      d="M 392 150 Q 300 -6 186 64"
      pathLength={1}
      className="landing-arc"
      style={{ fill: "none", stroke: BALL, strokeWidth: 3.5, strokeLinecap: "round" }}
    />
    <g className="landing-ball">
      {/* Speed trail, like the streaks on the wall art */}
      <g style={{ stroke: WHITE, strokeWidth: 2.5, strokeLinecap: "round", opacity: 0.85 }}>
        <line x1={206} y1={47} x2={226} y2={38} />
        <line x1={209} y1={58} x2={236} y2={49} />
        <line x1={205} y1={70} x2={222} y2={65} />
      </g>
      <circle cx={186} cy={64} r={13} style={{ fill: BALL, stroke: "var(--color-brand-ink)", strokeWidth: 2 }} />
      {/* The holes of a pickleball */}
      <g style={{ fill: "var(--color-brand-court-deep)" }}>
        <circle cx={181} cy={59} r={2.1} />
        <circle cx={191} cy={59} r={2.1} />
        <circle cx={186} cy={67.5} r={2.1} />
        <circle cx={179} cy={68.5} r={1.6} />
        <circle cx={193} cy={68.5} r={1.6} />
      </g>
    </g>

    <Camera x={-52} side="left" name="Cam 1" />
    <Camera x={COURT_W + 22} side="right" name="Cam 2" />
  </svg>
);

/** The game the rally ends up in: a lime bar that fills from Start game up to "now". */
export const ReplayBar = () => (
  <div>
    <div
      className="relative overflow-hidden"
      style={{ height: 10, borderRadius: 999, background: "rgb(255 255 255 / 0.16)" }}
    >
      <div
        className="landing-fill absolute inset-0"
        style={{ background: BALL, borderRadius: 999 }}
      />
    </div>
    <div className="flex justify-between mt-2" style={{ fontSize: 13 }}>
      <span style={{ color: WHITE, opacity: 0.7 }}>Game started</span>
      <span style={{ color: WHITE, fontWeight: 600 }}>Recording now</span>
    </div>
  </div>
);

export default HeroCourt;
