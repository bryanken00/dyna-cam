import { Link, NavLink } from "react-router";
import { LogOut } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { DISCOVER_NAV, PLAYER_RAIL_WIDTH, PLAYER_SIDEBAR_WIDTH, YOU_NAV, isNavActive } from "./playerNav";
import ThemeToggle from "../ThemeToggle";
import DGMark from "../brand/DGMark";
import Wordmark from "../brand/Wordmark";
import GoogleSignInButton from "../player/GoogleSignInButton";
import { usePlayerSignedIn } from "../../store/playerStore";
import { useGetPlayerMe, useSignOutPlayer } from "../../services/requests/public/player";

const initials = (name = "") =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("") || "?";

/** A label on the right of an icon, only when the sidebar is folded. */
const Tip = ({ show, label, children }) =>
  show ? (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  ) : (
    children
  );

const SectionTitle = ({ children, collapsed }) =>
  collapsed ? (
    <div className="mx-3 my-3" style={{ borderTop: "1px solid var(--color-line)" }} />
  ) : (
    <div
      className="px-3 pt-5 pb-1.5"
      style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-text-muted)" }}
    >
      {children}
    </div>
  );

/** One place: the Admin portal's nav row, with its 2px accent bar when it's the current one. */
const Item = ({ item, pathname, collapsed }) => {
  const active = isNavActive(item, pathname);
  const Icon = item.icon;
  return (
    <div className="relative">
      {active && !collapsed && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full" style={{ background: "var(--color-secondary-color)" }} />
      )}
      <Tip show={collapsed} label={item.label}>
        <NavLink to={item.to} className="block no-underline" aria-current={active ? "page" : undefined} aria-label={item.label}>
          <div className={`nav-item${active ? " is-active" : ""}${collapsed ? " justify-center" : ""}`}>
            <Icon className="w-4 h-4 shrink-0" />
            {!collapsed && <span className="text-sm flex-1 truncate">{item.label}</span>}
          </div>
        </NavLink>
      </Tip>
    </div>
  );
};

/** The bottom corner: who's signed in (and Sign out), or Sign in. */
const Account = ({ collapsed }) => {
  const signedIn = usePlayerSignedIn();
  const { data } = useGetPlayerMe();
  const signOut = useSignOutPlayer();
  const player = data?.data?.player;

  if (!signedIn) {
    return collapsed ? (
      <Tip show label="Sign in with Google">
        <span className="flex justify-center">
          <GoogleSignInButton size="icon" label="" />
        </span>
      </Tip>
    ) : (
      <GoogleSignInButton size="sm" label="Sign in" />
    );
  }
  const avatar = (
    <Avatar className="size-8 shrink-0">
      {player?.photoUrl && <AvatarImage src={player.photoUrl} alt="" referrerPolicy="no-referrer" />}
      <AvatarFallback style={{ fontSize: 12, fontWeight: 600 }}>{initials(player?.name)}</AvatarFallback>
    </Avatar>
  );
  if (collapsed) {
    return (
      <Tip show label={player?.name || "Your profile"}>
        <Link to="/me/profile" className="flex justify-center no-underline" aria-label="Your profile">
          {avatar}
        </Link>
      </Tip>
    );
  }
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <Link to="/me/profile" className="flex items-center gap-2.5 min-w-0 flex-1 no-underline">
        {avatar}
        <span className="min-w-0 leading-tight">
          <span className="block truncate" style={{ fontSize: 13.5, fontWeight: 600, color: "var(--color-text-dark)" }}>
            {player?.name || "Your account"}
          </span>
          <span className="block truncate" style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
            {player?.email || ""}
          </span>
        </span>
      </Link>
      <button
        type="button"
        className="icon-btn w-8 h-8 shrink-0"
        aria-label="Sign out"
        title="Sign out"
        onClick={() => signOut.mutate()}
        disabled={signOut.isPending}
      >
        <LogOut className="w-4 h-4" />
      </button>
    </div>
  );
};

/**
 * PLAN-009: the player app's sidebar, from tablets up — the brand, Discover's
 * four lists, the player's own places, and their account and the theme at the
 * bottom. `collapsed` folds it to an icon rail (the top bar's toggle). Phones
 * get the bottom tab bar instead (PlayerTabs.jsx).
 */
const PlayerSidebar = ({ pathname, collapsed = false }) => (
  <aside
    className="hidden md:flex fixed inset-y-0 left-0 z-30 flex-col theme-transition transition-[width] duration-200"
    style={{
      width: collapsed ? PLAYER_RAIL_WIDTH : PLAYER_SIDEBAR_WIDTH,
      background: "var(--color-surface)",
      borderRight: "1px solid var(--color-line)",
    }}
  >
    <Link to="/" className={`shrink-0 flex items-center gap-2.5 pt-5 pb-3 no-underline ${collapsed ? "justify-center px-0" : "px-4"}`}>
      <DGMark size={26} />
      {!collapsed && (
        <span className="min-w-0 leading-tight">
          <span className="block truncate">
            <Wordmark size={15} />
          </span>
          <span className="block truncate" style={{ fontSize: 11.5, color: "var(--color-text-muted)" }}>
            Pickleball
          </span>
        </span>
      )}
    </Link>

    <nav aria-label="Main" className="flex-1 overflow-y-auto overflow-x-hidden px-3 pb-3">
      <SectionTitle collapsed={collapsed}>Discover</SectionTitle>
      <div className="space-y-0.5">
        {DISCOVER_NAV.map((item) => (
          <Item key={item.to} item={item} pathname={pathname} collapsed={collapsed} />
        ))}
      </div>
      <SectionTitle collapsed={collapsed}>You</SectionTitle>
      <div className="space-y-0.5">
        {YOU_NAV.map((item) => (
          <Item key={item.to} item={item} pathname={pathname} collapsed={collapsed} />
        ))}
      </div>
    </nav>

    <div className="shrink-0 p-3 space-y-3" style={{ borderTop: "1px solid var(--color-line)" }}>
      <Account collapsed={collapsed} />
      <div className={`flex items-center ${collapsed ? "justify-center" : "justify-between"}`}>
        {!collapsed && <span style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>Theme</span>}
        <ThemeToggle />
      </div>
    </div>
  </aside>
);

export default PlayerSidebar;
