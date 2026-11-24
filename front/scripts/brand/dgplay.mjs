/**
 * The DGPlay logo — the native app's icon (decided 6 Nov 2026; artwork 10 Nov).
 *
 * A D and a G in one white frame: a ring at its middle holds a lime pickleball,
 * the D's top and the G's foot are cut from the ring by a thin curve, and the
 * G's stem stops halfway up its right side. On the logo's blue, darker at the
 * top.
 *
 * **Measured, not invented.** The owner supplied the logo as a 153×105 PNG
 * (dgplay-logo-supplied.png) — too small for a 1024 store icon, and blurry if
 * stretched. Every number below was read off that image, in its pixels, so the
 * logo can be drawn crisp at any size. Change a number, run
 * `node app/scripts/icons.mjs`, and compare with the supplied image.
 *
 * The website keeps the DGSports mark (mark.mjs); this is the app's alone.
 *
 * Plain Node, no dependencies, for the same reason as mark.mjs.
 */

export const COLORS = Object.freeze({
  // The tile: top to bottom, slightly towards the right.
  skyTop: '#174F8A',
  skyBottom: '#4189C8',
  // Where the ball sits, a shade under the tile.
  wellTop: '#215A95',
  wellEdge: '#184C80',
  white: '#FFFFFF',
  // The ball, lit from the top left.
  ballLight: '#F3FD6A',
  ball: '#E2F41F',
  ballShade: '#C2D80C',
  hole: '#0B2333',
});

export const GEOMETRY = Object.freeze({
  // The frame: four bars, the same width.
  frame: { left: 8.2, right: 147.4, top: 8.8, bottom: 99.6, bar: 11.8 },
  // The G's stem starts here, halfway down the right side.
  stemTop: 55.8,
  /*
   * The ring: wider than tall, and a little flatter below its middle than
   * above. Its inside is not given — it meets the top bar's underside and the
   * bottom bar's top exactly, which is what makes the ring run into the bars
   * without a step (the first redraw left one, 10 Nov). Its outside reaches
   * just past the frame, so the curved cuts cross a bar cleanly.
   */
  ring: { cx: 78.6, cy: 55.4, rxOut: 47.3, ryOutTop: 46.9, ryOutBottom: 44.5, rxIn: 34.7 },
  // The curved cuts, just outside the ring, and the straight ones beside the bars.
  curve: 4.2,
  gap: 5.7,
  ball: { cx: 78.5, cy: 54.5, r: 27 },
  // The holes: centre, radii and turn in degrees — as they sit in the image.
  holes: [
    [70.3, 39.0, 3.9, 3.3, -20],
    [89.6, 34.2, 4.3, 2.1, 35],
    [86.6, 47.2, 3.5, 3.5, 0],
    [58.6, 54.0, 2.3, 4.2, 0],
    [100.3, 53.6, 1.8, 3.6, 5],
    [73.1, 61.2, 4.0, 3.4, 10],
    [91.0, 67.0, 3.4, 3.0, -20],
    [67.6, 74.0, 3.5, 2.3, 30],
    [84.0, 78.6, 3.1, 1.5, -5],
  ],
});

const { frame: f, stemTop, ring, curve, gap, ball, holes } = GEOMETRY;

/* ------------------------------------------------------------------ colours */

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export const RGB = Object.freeze(Object.fromEntries(Object.entries(COLORS).map(([k, v]) => [k, hex(v)])));

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * Math.min(1, Math.max(0, t))));

/** The tile's blue at a point of a unit square: top to bottom, a little to the right. */
export function sky(u, v) {
  return mix(RGB.skyTop, RGB.skyBottom, (u * 0.25 + v) / 1.0625);
}

/* ------------------------------------------------------------------- shapes */

const inEllipse = (x, y, rx, ry) => ((x - ring.cx) / rx) ** 2 + ((y - ring.cy) / ry) ** 2 <= 1;

// The ring's edges, upper half and lower half. Both halves share a width at the
// middle, so each edge is one smooth curve.
const upper = (y) => y < ring.cy;
const ryOut = (y) => (upper(y) ? ring.ryOutTop : ring.ryOutBottom);
const ryIn = (y) => (upper(y) ? ring.cy - (f.top + f.bar) : (f.bottom - f.bar) - ring.cy);
const inOuter = (x, y, grow = 0) => inEllipse(x, y, ring.rxOut + grow, ryOut(y) + grow);
const inInner = (x, y, grow = 0) => inEllipse(x, y, ring.rxIn + grow, ryIn(y) + grow);

function inFrame(x, y) {
  if (x < f.left || x > f.right || y < f.top || y > f.bottom) return false;
  return x <= f.left + f.bar // the D's back
    || y <= f.top + f.bar // across the top
    || y >= f.bottom - f.bar // across the bottom
    || (x >= f.right - f.bar && y >= stemTop); // the G's stem
}

function inRing(x, y) {
  if (x < f.left || x > f.right || y < f.top || y > f.bottom) return false;
  return inOuter(x, y) && !inInner(x, y);
}

/**
 * The four cuts that make a frame and a ring into a D and a G: a curve just
 * outside the ring at the top left and the bottom right, and a straight one
 * under the top bar on the right and over the bottom bar on the left.
 */
function inCut(x, y) {
  const justOutside = !inOuter(x, y) && inOuter(x, y, curve);
  if (justOutside && x < ring.cx && y < ring.cy) return true;
  if (justOutside && x > ring.cx && y > ring.cy) return true;
  const underTop = f.top + f.bar;
  if (x >= ring.cx && x <= f.right - f.bar && y >= underTop && y <= underTop + gap) return true;
  const overBottom = f.bottom - f.bar;
  return x >= f.left + f.bar && x <= ring.cx && y >= overBottom - gap && y <= overBottom;
}

function inHole(x, y) {
  return holes.some(([cx, cy, rx, ry, turn]) => {
    const a = (-turn * Math.PI) / 180;
    const dx = x - cx;
    const dy = y - cy;
    const along = dx * Math.cos(a) - dy * Math.sin(a);
    const across = dx * Math.sin(a) + dy * Math.cos(a);
    return (along / rx) ** 2 + (across / ry) ** 2 <= 1;
  });
}

const inBall = (x, y) => Math.hypot(x - ball.cx, y - ball.cy) <= ball.r;

/* ------------------------------------------------- the logo, per sample */

/*
 * The 100-unit box the icon script samples, as mark.mjs's: the frame's width
 * is 100, centred on 50,50.
 */
const UNIT = (f.right - f.left) / 100;
const MID = { x: (f.left + f.right) / 2, y: (f.top + f.bottom) / 2 };

/**
 * The colour at one point in the 100-unit box, or null for whatever is
 * underneath. `ink` draws the whole logo in that one colour, holes cut out —
 * Android's themed icon.
 */
export function paint(bx, by, { ink = null } = {}) {
  const x = MID.x + (bx - 50) * UNIT;
  const y = MID.y + (by - 50) * UNIT;

  if (inBall(x, y)) {
    if (inHole(x, y)) return ink ? null : RGB.hole;
    if (ink) return ink;
    // Lit from 38% across and 32% down the ball, fading over three quarters of it.
    const t = Math.hypot(x - (ball.cx - ball.r + 0.76 * ball.r), y - (ball.cy - ball.r + 0.64 * ball.r)) / (1.5 * ball.r);
    return t < 0.55 ? mix(RGB.ballLight, RGB.ball, t / 0.55) : mix(RGB.ball, RGB.ballShade, (t - 0.55) / 0.45);
  }
  if ((inFrame(x, y) || inRing(x, y)) && !inCut(x, y)) return ink ?? RGB.white;
  if (!ink && inInner(x, y, 0.2)) {
    const t = Math.hypot((x - ring.cx) / ring.rxIn, (y - ring.cy + 0.2 * ryIn(y)) / ryIn(y)) / 1.2;
    return mix(RGB.wellTop, RGB.wellEdge, t);
  }
  return null;
}
