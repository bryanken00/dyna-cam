import { NavLink } from "react-router";
import { GraduationCap, LayoutGrid, Trophy, Users } from "lucide-react";

const TABS = [
  { to: "/book", label: "Courts", icon: LayoutGrid },
  { to: "/open-play", label: "Open Play", icon: Users },
  // PLAN-009 phase E
  { to: "/events", label: "Tournaments", icon: Trophy },
  // PLAN-009 phase F
  { to: "/coaching", label: "Coaching", icon: GraduationCap },
];

/**
 * PLAN-009: Discover's lists on phones — courts, Open Play, tournaments,
 * coaching. From tablets up the sidebar lists them instead, so this hides.
 */
const DiscoverTabs = () => (
  <nav aria-label="Discover" className="md:hidden inline-flex max-w-full overflow-x-auto p-1 gap-1" style={{ background: "var(--color-surface-sunken)", borderRadius: 12 }}>
    {TABS.map(({ to, label, icon: Icon }) => (
      <NavLink
        key={to}
        to={to}
        end
        className="inline-flex items-center gap-1.5 px-3.5 h-9 rounded-lg shrink-0 whitespace-nowrap"
        style={({ isActive }) => ({
          textDecoration: "none",
          fontSize: 13.5,
          fontWeight: isActive ? 600 : 500,
          color: isActive ? "var(--color-text-dark)" : "var(--color-text-secondary)",
          background: isActive ? "var(--color-surface)" : "transparent",
          border: isActive ? "1px solid var(--color-line)" : "1px solid transparent",
        })}
      >
        <Icon className="size-4" strokeWidth={1.9} />
        {label}
      </NavLink>
    ))}
  </nav>
);

export default DiscoverTabs;
