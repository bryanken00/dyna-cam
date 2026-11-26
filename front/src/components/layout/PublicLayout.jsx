import { Link } from "react-router";

import ThemeToggle from "../ThemeToggle";
import PlayerAccountMenu from "../player/PlayerAccountMenu";
import DGMark from "../brand/DGMark";
import Wordmark from "../brand/Wordmark";

/**
 * Chrome for the player pages (`/court/:qrToken`, `/clip/:shareToken`):
 * a slim top bar (brand + theme picker), one narrow mobile-first column, and a
 * footer slot for the privacy note. No login, no sidebar. CR-030: the brand
 * goes home. CR-032: `wide` widens the column for pages with a desktop
 * two-column layout (the venue booking page); phones see no difference.
 * PLAN-006: a signed-in player's account menu sits beside the theme picker on
 * every player page; `signIn` also offers "Sign in" to a signed-out visitor.
 */
const PublicLayout = ({ children, footer, wide = false, signIn = false }) => {
  const width = wide ? "max-w-6xl" : "max-w-md";

  return (
    <div
      className="min-h-dvh flex flex-col"
      style={{ background: "var(--color-canvas)" }}
    >
      <header
        className="px-4 py-3"
        style={{ borderBottom: "1px solid var(--color-line)" }}
      >
        <div className={`mx-auto ${width} flex items-center justify-between gap-3`}>
          {/* CR-036: the DGSports mark and wordmark */}
          <Link to="/" className="inline-flex items-center gap-2" style={{ textDecoration: "none" }}>
            <DGMark size={22} />
            <Wordmark size={15.5} />
          </Link>
          <div className="flex items-center gap-2">
            <PlayerAccountMenu showSignIn={signIn} />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className={`flex-1 w-full mx-auto ${width} px-4 py-6`}>{children}</main>

      {footer && (
        <footer
          className={`w-full mx-auto ${width} px-4 pb-6 text-center`}
          style={{
            fontSize: 12.5,
            color: "var(--color-text-muted)",
            paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))",
          }}
        >
          {footer}
        </footer>
      )}
    </div>
  );
};

export default PublicLayout;
