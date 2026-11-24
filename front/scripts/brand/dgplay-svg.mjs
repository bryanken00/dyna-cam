/**
 * CR-036: the DGPlay logo as SVG, drawn from dgplay.mjs's measurements (the
 * supplied 153×105 PNG's own pixels), so it's crisp at any size. The same
 * shapes as dgplay.mjs `paint()`: a white frame (the D's back, top and bottom
 * bars, the G's stem from halfway down) and a ring, cut into a D and a G by two
 * curves just outside the ring and two straight gaps beside the bars; a well
 * inside the ring; the lime ball with its holes. Coordinates are the PNG's.
 */
import { COLORS, GEOMETRY } from "./dgplay.mjs";

const { frame: f, stemTop, ring, curve, gap, ball, holes } = GEOMETRY;
const ryInTop = ring.cy - (f.top + f.bar);
const ryInBottom = f.bottom - f.bar - ring.cy;
const n = (v) => +v.toFixed(2);

/** A closed shape of two half ellipses: rx across, ry above and below the middle. */
const halves = (cx, cy, rx, ryTop, ryBottom) =>
  `M${n(cx - rx)} ${n(cy)}A${n(rx)} ${n(ryTop)} 0 0 1 ${n(cx + rx)} ${n(cy)}` +
  `A${n(rx)} ${n(ryBottom)} 0 0 1 ${n(cx - rx)} ${n(cy)}Z`;

const outer = (grow = 0) =>
  halves(ring.cx, ring.cy, ring.rxOut + grow, ring.ryOutTop + grow, ring.ryOutBottom + grow);
const inner = (grow = 0) => halves(ring.cx, ring.cy, ring.rxIn + grow, ryInTop + grow, ryInBottom + grow);

/** The logo's shapes, in the PNG's 153×105 space, with ids prefixed by `id`. */
export function logoShapes(id = "dgp", { ink = null, frame = COLORS.white, frameClass = null } = {}) {
  const W = f.right - f.left;
  const H = f.bottom - f.top;
  const frameRects = [
    [f.left, f.top, f.bar, H], // the D's back
    [f.left, f.top, W, f.bar], // across the top
    [f.left, f.bottom - f.bar, W, f.bar], // across the bottom
    [f.right - f.bar, stemTop, f.bar, f.bottom - stemTop], // the G's stem
  ]
    .map(([x, y, w, h]) => `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"/>`)
    .join("");
  // The cuts: the band just outside the ring, top-left and bottom-right quarters;
  // under the top bar on the right; over the bottom bar on the left.
  const band = `<path d="${outer(curve)}${outer()}" fill-rule="evenodd"/>`;
  const cuts = `
      <g clip-path="url(#${id}-tl)">${band}</g>
      <g clip-path="url(#${id}-br)">${band}</g>
      <rect x="${n(ring.cx)}" y="${n(f.top + f.bar)}" width="${n(f.right - f.bar - ring.cx)}" height="${n(gap)}"/>
      <rect x="${n(f.left + f.bar)}" y="${n(f.bottom - f.bar - gap)}" width="${n(ring.cx - f.left - f.bar)}" height="${n(gap)}"/>`;
  const holeEls = holes
    .map(
      ([cx, cy, rx, ry, turn]) =>
        `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" transform="rotate(${turn} ${cx} ${cy})"/>`
    )
    .join("");
  const wellR = ((ryInTop + ryInBottom) / 2) * 1.2;
  const defs = `
    <clipPath id="${id}-box"><rect x="${f.left}" y="${f.top}" width="${n(W)}" height="${n(H)}"/></clipPath>
    <clipPath id="${id}-tl"><rect x="0" y="0" width="${ring.cx}" height="${ring.cy}"/></clipPath>
    <clipPath id="${id}-br"><rect x="${ring.cx}" y="${ring.cy}" width="200" height="200"/></clipPath>
    <mask id="${id}-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="160" height="110">
      <rect width="160" height="110" fill="#fff"/>
      <g fill="#000">${cuts}</g>
    </mask>
    <radialGradient id="${id}-well" gradientUnits="userSpaceOnUse" cx="${ring.cx}" cy="${n(ring.cy - 0.2 * ryInTop)}"
      r="${n(wellR)}" gradientTransform="translate(${ring.cx} ${n(ring.cy - 0.2 * ryInTop)}) scale(${n(ring.rxIn / ((ryInTop + ryInBottom) / 2))} 1) translate(${-ring.cx} ${-n(ring.cy - 0.2 * ryInTop)})">
      <stop offset="0" stop-color="${COLORS.wellTop}"/><stop offset="1" stop-color="${COLORS.wellEdge}"/>
    </radialGradient>
    <radialGradient id="${id}-ball" gradientUnits="userSpaceOnUse" cx="${n(ball.cx - 0.24 * ball.r)}" cy="${n(ball.cy - 0.36 * ball.r)}" r="${n(1.5 * ball.r)}">
      <stop offset="0" stop-color="${COLORS.ballLight}"/><stop offset="0.55" stop-color="${COLORS.ball}"/><stop offset="1" stop-color="${COLORS.ballShade}"/>
    </radialGradient>
    <mask id="${id}-holes" maskUnits="userSpaceOnUse" x="0" y="0" width="160" height="110">
      <rect width="160" height="110" fill="#fff"/><g fill="#000">${holeEls}</g>
    </mask>`;
  const body = `
    ${ink ? "" : `<path d="${inner(0.2)}" fill="url(#${id}-well)"/>`}
    <g ${frameClass && !ink ? `class="${frameClass}"` : `fill="${ink ?? frame}"`} mask="url(#${id}-cut)">
      ${frameRects}
      <path d="${outer()}${inner()}" fill-rule="evenodd" clip-path="url(#${id}-box)"/>
    </g>
    ${ink ? "" : `<circle cx="${ball.cx}" cy="${ball.cy}" r="${ball.r}" fill="${COLORS.hole}"/>`}
    <circle cx="${ball.cx}" cy="${ball.cy}" r="${ball.r}" fill="${ink ?? `url(#${id}-ball)`}" mask="url(#${id}-holes)"/>`;
  return { defs, body };
}

/** The tile's blue, top to bottom and a little to the right (dgplay.mjs `sky`). */
const skyGradient = (id) =>
  `<linearGradient id="${id}-sky" x1="0" y1="0" x2="0.25" y2="1"><stop offset="0" stop-color="${COLORS.skyTop}"/><stop offset="1" stop-color="${COLORS.skyBottom}"/></linearGradient>`;

/** The logo as supplied: on its blue, 153×105 (`background: false` for a blue band; `ink` for one colour). */
export function logoSvg({ id = "dgp", background = true, ink = null } = {}) {
  const { defs, body } = logoShapes(id, { ink });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 153 105" role="img" aria-label="DGPlay">
  <defs>${skyGradient(id)}${defs}</defs>
  ${background ? `<rect width="153" height="105" fill="url(#${id}-sky)"/>` : ""}
  ${body}
</svg>
`;
}

/**
 * A square icon: the logo centred on its blue. `scale` is the logo's width as
 * a share of the square (0.78 for a normal icon; ~0.62 keeps it inside a
 * maskable icon's safe circle); `radius` rounds the tile (0 = full bleed);
 * `ink` draws the logo alone in one colour (Safari's pinned-tab mask).
 */
export function iconSvg({ id = "dgi", scale = 0.78, radius = 22, ink = null } = {}) {
  const { defs, body } = logoShapes(id, { ink });
  const W = f.right - f.left;
  const k = (100 * scale) / W;
  const tx = 50 - k * (f.left + W / 2);
  const ty = 50 - k * (f.top + (f.bottom - f.top) / 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="DGPlay">
  <defs>${skyGradient(id)}${defs}</defs>
  ${ink ? "" : `<rect width="100" height="100" rx="${radius}" fill="url(#${id}-sky)"/>`}
  <g transform="translate(${n(tx)} ${n(ty)}) scale(${n(k)})">${body}</g>
</svg>
`;
}

/**
 * CR-036: the logo alone, no background, in a square — for the browser tab
 * and the app's light pages. The frame is the logo's blue on a light ground
 * and white on a dark one (`adaptive`: by the viewer's colour scheme, for the
 * favicon), or always `frame`.
 */
export function bareSvg({ id = "dgb", frame = "#174F8A", adaptive = false, square = true } = {}) {
  const { defs, body } = logoShapes(id, { frame, frameClass: adaptive ? "fr" : null });
  const style = adaptive
    ? `<style>.fr{fill:${frame}}@media (prefers-color-scheme: dark){.fr{fill:${COLORS.white}}}</style>`
    : "";
  if (!square) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f.left - 1} ${f.top - 1} ${n(f.right - f.left + 2)} ${n(f.bottom - f.top + 2)}" role="img" aria-label="DGPlay">
  ${style}<defs>${defs}</defs>
  ${body}
</svg>
`;
  }
  const W = f.right - f.left;
  const k = 100 / (W + 2);
  const tx = 50 - k * (f.left + W / 2);
  const ty = 50 - k * (f.top + (f.bottom - f.top) / 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="DGPlay">
  ${style}<defs>${defs}</defs>
  <g transform="translate(${n(tx)} ${n(ty)}) scale(${n(k)})">${body}</g>
</svg>
`;
}
