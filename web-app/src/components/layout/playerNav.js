import {
  CalendarCheck,
  Compass,
  GraduationCap,
  LayoutGrid,
  Trophy,
  UserRound,
  Users,
  UsersRound,
} from "lucide-react";

/**
 * PLAN-009: the player app's places, shared by the sidebar (tablets up) and the
 * bottom tab bar (phones). `match` lists the paths that light an entry up.
 */
export const DISCOVER_NAV = [
  { to: "/book", label: "Courts", icon: LayoutGrid, match: ["/book"] },
  { to: "/open-play", label: "Open Play", icon: Users, match: ["/open-play"] },
  { to: "/events", label: "Tournaments", icon: Trophy, match: ["/events", "/team-invite"] },
  { to: "/coaching", label: "Coaching", icon: GraduationCap, match: ["/coaching"] },
];

export const YOU_NAV = [
  { to: "/me/games", label: "Play", icon: CalendarCheck, match: ["/me/games", "/booking"] },
  { to: "/clubs", label: "Clubs", icon: UsersRound, match: ["/clubs"] },
  { to: "/me/profile", label: "Profile", icon: UserRound, match: ["/me/profile"] },
];

/** The phone tab bar: Discover stands for its four lists. */
export const TAB_NAV = [
  { to: "/book", label: "Discover", icon: Compass, match: DISCOVER_NAV.flatMap((d) => d.match) },
  ...YOU_NAV,
];

export const isNavActive = (item, pathname) =>
  item.match.some((root) => pathname === root || pathname.startsWith(`${root}/`));

/** The sidebar's width (px), and folded to an icon rail — PublicLayout offsets the page by it. */
export const PLAYER_SIDEBAR_WIDTH = 248;
export const PLAYER_RAIL_WIDTH = 72;

/**
 * The top bar's words for a path: { group, title } — "Discover / Courts", or just
 * "Play". A path no place claims (signing in) is the app's name.
 */
export const pageTitle = (pathname) => {
  const discover = DISCOVER_NAV.find((item) => isNavActive(item, pathname));
  if (discover) return { group: "Discover", title: discover.label };
  const you = YOU_NAV.find((item) => isNavActive(item, pathname));
  if (you) return { group: null, title: you.label };
  return { group: null, title: "DGSports" };
};
