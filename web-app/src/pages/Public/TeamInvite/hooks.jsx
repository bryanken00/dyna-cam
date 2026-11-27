import { useCallback, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";

import { usePlayerSignedIn } from "../../../store/playerStore";
import { decodeHTML } from "../../../utils/decode-html";
import { dateRange } from "../../../utils/tournaments";
import { useGetTeamInvite, useJoinTeam } from "../../../services/requests/public/tournaments";
import { useProfileRedirect } from "../../../services/requests/public/player";

/**
 * `/team-invite/:inviteToken` (PLAN-009 phase E): the link a captain sends their
 * partner. It shows the team; signed in, Join puts the partner on it.
 */
export const useTeamInviteHooks = () => {
  const { inviteToken } = useParams();
  const navigate = useNavigate();
  const signedIn = usePlayerSignedIn();
  const returnPath = `/team-invite/${inviteToken}`;
  const profileRedirect = useProfileRedirect(returnPath);
  const { data, isLoading, error } = useGetTeamInvite(inviteToken);
  const join = useJoinTeam();
  const [joinError, setJoinError] = useState("");
  const invite = data?.data?.invite || null;

  const handleJoin = useCallback(() => {
    setJoinError("");
    join.mutate(inviteToken, {
      onSuccess: (res) => {
        toast.success(res?.message || "You're on the team");
        navigate(`/events/${invite.tournamentKey}`, { replace: true });
      },
      onError: (err) => setJoinError(err?.response?.data?.message || "Couldn't join — please try again."),
    });
  }, [join, inviteToken, invite, navigate]);

  return {
    signedIn,
    profileRedirect,
    returnPath,
    invite: invite && {
      teamName: decodeHTML(invite.teamName),
      captain: decodeHTML(invite.captain || ""),
      division: decodeHTML(invite.divisionName),
      tournament: decodeHTML(invite.tournamentName),
      when: dateRange(invite.startDate, invite.endDate),
      venue: decodeHTML(invite.venueName),
    },
    isLoading,
    gone: error?.response?.status === 404,
    loadError: error && error?.response?.status !== 404 ? error : null,
    handleJoin,
    isJoining: join.isPending,
    joinError,
  };
};
