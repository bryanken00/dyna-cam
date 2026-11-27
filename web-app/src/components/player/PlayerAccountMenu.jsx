import { Link, useLocation } from "react-router";
import { History, LogOut, UserRound } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import GoogleSignInButton from "./GoogleSignInButton";
import { usePlayerSignedIn } from "../../store/playerStore";
import { useGetPlayerMe, useSignOutPlayer } from "../../services/requests/public/player";

const initials = (name = "") =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("") || "?";

/**
 * PLAN-006: the player pages' account corner. Signed in: their Google photo
 * and a menu (Your profile, My games, Sign out). Signed out: a small "Sign in" button where
 * the page asks for one (`showSignIn`), nothing elsewhere.
 */
const PlayerAccountMenu = ({ showSignIn = false }) => {
  const signedIn = usePlayerSignedIn();
  const location = useLocation();
  const { data } = useGetPlayerMe();
  const signOut = useSignOutPlayer();
  const player = data?.data?.player;

  if (!signedIn) {
    return showSignIn ? <GoogleSignInButton size="sm" label="Sign in" /> : null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={player ? `Signed in as ${player.name}` : "Your account"}
      >
        <Avatar className="size-8">
          {player?.photoUrl && (
            <AvatarImage src={player.photoUrl} alt="" referrerPolicy="no-referrer" />
          )}
          <AvatarFallback style={{ fontSize: 12, fontWeight: 600 }}>
            {initials(player?.name)}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {player && (
          <>
            <DropdownMenuLabel className="font-normal">
              <div className="truncate" style={{ fontSize: 13.5, fontWeight: 600, color: "var(--color-text-dark)" }}>
                {player.name}
              </div>
              <div className="truncate" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
                {player.email}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem asChild>
          <Link to={`/me/profile?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`}>
            <UserRound />
            Your profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/me/games">
            <History />
            My games
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => signOut.mutate()} disabled={signOut.isPending}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default PlayerAccountMenu;
