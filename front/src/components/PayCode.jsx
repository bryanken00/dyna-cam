import { formatPayCode } from "../utils/dynaCam";

/**
 * A pay code, large and spaced, as the player shows it at the desk ("K7Q M2P")
 * — a clip's (PLAN-001 Phase 4) or a game's (CR-015).
 */
const PayCode = ({ code, size = 34 }) => (
  <div
    className="font-mono font-semibold select-all"
    aria-label={`Pay code ${String(code || "").split("").join(" ")}`}
    style={{
      fontSize: size,
      letterSpacing: "0.12em",
      color: "var(--color-text-dark)",
    }}
  >
    {formatPayCode(code)}
  </div>
);

export default PayCode;
