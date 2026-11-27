import { NavLink } from "react-router";

import { TAB_NAV, isNavActive } from "./playerNav";

/**
 * PLAN-009: phones' bottom tab bar — Discover, Play, Clubs, Profile — fixed to
 * the bottom of the screen, clear of the home indicator. From tablets up the
 * sidebar (PlayerSidebar.jsx) takes its place.
 */
export const PlayerTabBar = ({ pathname }) => (
  <nav
    aria-label="Main"
    className="md:hidden fixed inset-x-0 bottom-0 z-40"
    style={{
      background: "var(--color-surface)",
      borderTop: "1px solid var(--color-line)",
      paddingBottom: "env(safe-area-inset-bottom)",
    }}
  >
    <ul className="m-0 p-0 list-none grid grid-cols-4">
      {TAB_NAV.map((tab) => {
        const active = isNavActive(tab, pathname);
        const Icon = tab.icon;
        return (
          <li key={tab.to}>
            <NavLink
              to={tab.to}
              aria-current={active ? "page" : undefined}
              className="flex flex-col items-center justify-center gap-1 h-16"
              style={{
                textDecoration: "none",
                fontSize: 11.5,
                fontWeight: active ? 600 : 500,
                color: active ? "var(--color-link)" : "var(--color-text-muted)",
              }}
            >
              <Icon className="size-5.5" strokeWidth={active ? 2.2 : 1.8} />
              {tab.label}
            </NavLink>
          </li>
        );
      })}
    </ul>
  </nav>
);

export default PlayerTabBar;
