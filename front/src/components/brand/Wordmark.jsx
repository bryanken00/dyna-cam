import { APP_NAME } from "./appName";

/**
 * CR-036: the DGSports wordmark, in the brand typeface (Space Grotesk): "DG"
 * bold, "Sports" regular. On the page "DG" takes the link blue (lifted in dark); on the
 * blue brand band it's white with "Sports" in the ball's lime, as the logo
 * pairs them. Any other `VITE_APP_NAME` is shown as plain text in the same face.
 *
 * Props: `size` (px, default 15.5); `onBrand` (default false) — on the blue band.
 */
const Wordmark = ({ size = 15.5, onBrand = false }) => {
  const color = onBrand ? "var(--color-brand-on-court)" : "var(--color-text-dark)";
  const style = { fontFamily: "var(--font-display)", fontSize: size, letterSpacing: "-0.02em", color, lineHeight: 1.1 };

  if (!APP_NAME.startsWith("DG")) {
    return (
      <span className="font-semibold" style={style}>
        {APP_NAME}
      </span>
    );
  }
  return (
    <span style={style}>
      <span style={{ fontWeight: 700, color: onBrand ? color : "var(--color-link)" }}>DG</span>
      <span style={{ fontWeight: 500, color: onBrand ? "var(--color-brand-ball)" : color }}>
        {APP_NAME.slice(2)}
      </span>
    </span>
  );
};

export default Wordmark;
