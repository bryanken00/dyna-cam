import { CUSTOMDIALOGSTATUS, useCustomDialog } from "@/hooks/useCustomDialog";
import { useMyGames, useSignOut } from "@/services/requests/player";
import { APP_MODE, useAppModeStore } from "@/store/useAppModeStore";
import { usePlayerStore } from "@/store/usePlayerStore";

/**
 * Me's state (PLAN-009): the profile, the game log (upcoming, then past, each
 * with its videos' Drive links), sign out, and turning this phone into a
 * courtside device.
 */
export const useMeScreen = () => {
  const player = usePlayerStore((s) => s.player);
  const setMode = useAppModeStore((s) => s.setMode);
  const games = useMyGames();
  const signOut = useSignOut();
  const openDialog = useCustomDialog();

  const confirmSignOut = () =>
    openDialog({
      title: "Sign out?",
      message: "You'll need to sign in with Google again to book.",
      confirmText: "Sign out",
      status: CUSTOMDIALOGSTATUS.warning,
      onConfirm: () => signOut.mutate(),
    });

  const confirmDeviceMode = () =>
    openDialog({
      title: "Use this phone at the court?",
      message:
        "It becomes a courtside device for a game's live view and QR. You stay signed in, and can switch back from its pairing screen.",
      confirmText: "Switch",
      status: CUSTOMDIALOGSTATUS.warning,
      onConfirm: () => setMode(APP_MODE.device),
    });

  return {
    player,
    upcoming: games.data?.data?.upcoming || [],
    past: games.data?.data?.past || [],
    gamesLoading: games.isLoading,
    gamesError: games.isError,
    refreshing: games.isRefetching,
    refresh: games.refetch,
    signingOut: signOut.isPending,
    confirmSignOut,
    confirmDeviceMode,
  };
};
