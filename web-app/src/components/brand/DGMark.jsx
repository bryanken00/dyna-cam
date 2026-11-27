/*
 * CR-036: the DGPlay logo (brand kit temp/brand/dgplay-logo-supplied.png) — a D
 * and a G in one frame around a lime pickleball — drawn without its blue tile:
 * the frame in the logo's blue on a light page, white in the dark theme and on
 * the blue brand band. The files in public/brand/ are drawn from the logo's
 * measurements by `node scripts/brand-icons.mjs` (scripts/brand/dgplay.mjs),
 * the same source as the favicon and app icons, so every size matches.
 */
const ON_LIGHT = "/brand/logo-blue.svg"; // blue frame, transparent
const ON_DARK = "/brand/logo-on-blue.svg"; // white frame, transparent
const RATIO = 141.2 / 92.8; // the logo's box (its frame, plus a unit's margin)

/**
 * Props: `size` (px, default 30) — the logo's height; `tile` (default true) —
 * kept for the call sites: true follows the theme (blue frame on light, white
 * on dark), false is always white (on the blue brand band); `title` — an
 * accessible name (default: decorative).
 */
const DGMark = ({ size = 30, tile = true, title }) => {
  const img = (src, className) => (
    <img
      src={src}
      width={Math.round(size * RATIO)}
      height={size}
      alt={title || ""}
      aria-hidden={title ? undefined : true}
      className={`shrink-0 select-none ${className}`}
      draggable={false}
    />
  );
  if (!tile) return img(ON_DARK, "");
  return (
    <>
      {img(ON_LIGHT, "dark:hidden")}
      {img(ON_DARK, "hidden dark:block")}
    </>
  );
};

export default DGMark;
