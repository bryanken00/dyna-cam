import { Link, useLocation } from "react-router";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import ThemeToggle from "../ThemeToggle";
import PlayerAccountMenu from "../player/PlayerAccountMenu";
import DGMark from "../brand/DGMark";
import Wordmark from "../brand/Wordmark";
import PlayerSidebar from "./PlayerSidebar";
import { PlayerTabBar } from "./PlayerTabs";
import { PLAYER_RAIL_WIDTH, PLAYER_SIDEBAR_WIDTH, pageTitle } from "./playerNav";
import { useLayoutStore } from "../../store/layoutStore";

/**
 * The player app's frame (PLAN-009).
 *
 *   Tablets and up: the sidebar on the left (PlayerSidebar.jsx) — every place,
 *   the account and the theme — and beside it a top bar like the Admin portal's:
 *   the button that folds the sidebar to an icon rail, and where you are
 *   ("Discover / Courts"). The fold is remembered in this browser.
 *   Phones: a slim top bar (brand, account, theme), the page in one column, and
 *   the bottom tab bar.
 *
 * `wide` gives pages with a two-column desktop layout more room (CR-032); the
 * others keep a readable column. `footer` is the small print under the page.
 * `signIn` also offers "Sign in" in the phone top bar to a signed-out visitor.
 */
const PublicLayout = ({ children, footer, wide = false, signIn = false }) => {
  const width = wide ? "max-w-6xl" : "max-w-2xl";
  const { pathname } = useLocation();
  const collapsed = useLayoutStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const { group, title } = pageTitle(pathname);

  return (
    <div className="min-h-dvh" style={{ background: "var(--color-canvas)" }}>
      <PlayerSidebar pathname={pathname} collapsed={collapsed} />

      <div
        className="min-h-dvh flex flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0 md:pl-(--sidebar-width) transition-[padding] duration-200"
        style={{ "--sidebar-width": `${collapsed ? PLAYER_RAIL_WIDTH : PLAYER_SIDEBAR_WIDTH}px` }}
      >
        {/* Tablets and up: fold the sidebar, and where you are */}
        <header
          className="hidden md:flex theme-transition sticky top-0 z-20 shrink-0 items-center gap-3 px-6 h-16"
          style={{ backgroundColor: "var(--color-surface)", borderBottom: "1px solid var(--color-border)" }}
        >
          <button
            type="button"
            className="icon-btn w-9 h-9 shrink-0"
            aria-label={collapsed ? "Show the sidebar" : "Fold the sidebar"}
            aria-expanded={!collapsed}
            onClick={toggleSidebar}
          >
            {collapsed ? <PanelLeftOpen className="w-4.5 h-4.5" /> : <PanelLeftClose className="w-4.5 h-4.5" />}
          </button>
          <div className="flex items-center gap-1.5 min-w-0">
            {group && (
              <>
                <span className="text-xs truncate" style={{ color: "var(--color-text-muted)" }}>
                  {group}
                </span>
                <span style={{ color: "var(--color-text-muted)" }}>/</span>
              </>
            )}
            <span className="text-base font-semibold truncate" style={{ color: "var(--color-text-dark)" }}>
              {title}
            </span>
          </div>
        </header>

        {/* Phones only: the brand, account and theme */}
        <header className="md:hidden px-4 py-3" style={{ borderBottom: "1px solid var(--color-line)" }}>
          <div className="flex items-center justify-between gap-3">
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

        <main className={`flex-1 w-full mx-auto ${width} px-4 py-6 md:px-8 md:py-8`}>{children}</main>

        {footer && (
          <footer
            className={`w-full mx-auto ${width} px-4 md:px-8 pb-6 text-center`}
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

      <PlayerTabBar pathname={pathname} />
    </div>
  );
};

export default PublicLayout;
