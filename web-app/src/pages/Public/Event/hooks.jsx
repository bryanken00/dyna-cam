import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import dayjs from "dayjs";
import { toast } from "sonner";

import { confirm } from "../../../store/confirmStore";
import { usePlayerSignedIn } from "../../../store/playerStore";
import { copyText } from "../../../utils/clipboard";
import { decodeHTML } from "../../../utils/decode-html";
import { formatPeso } from "../../../utils/dynaCam";
import { dateRange } from "../../../utils/tournaments";
import {
  useGetMyTeams,
  useGetTournament,
  usePayTeam,
  useRegisterTeam,
  useWithdrawTeam,
} from "../../../services/requests/public/tournaments";
import { useProfileRedirect } from "../../../services/requests/public/player";

const errorText = (err) =>
  err?.response?.data?.message || (err?.response ? "Something went wrong — please try again." : "Couldn't reach DGSports — check your connection.");

/**
 * `/events/:key` (PLAN-009 phase E): a tournament — its divisions (register a
 * team), the player's own entry (pay, send the invite, withdraw), and each
 * division's draw, standings and schedule. Back from paying (`?checkout=done`)
 * the entry's payment is checked once.
 */
export const useEventHooks = () => {
  const { tournamentKey } = useParams();
  const [params, setParams] = useSearchParams();
  const signedIn = usePlayerSignedIn();
  const returnPath = `/events/${tournamentKey}`;
  const profileRedirect = useProfileRedirect(returnPath);
  const { data, isLoading, error, refetch, isFetching } = useGetTournament(tournamentKey);
  const { data: teamsData } = useGetMyTeams();
  const register = useRegisterTeam();
  const pay = usePayTeam();
  const withdraw = useWithdrawTeam();
  const [teamName, setTeamName] = useState("");
  const [actionError, setActionError] = useState("");

  const raw = data?.data || null;
  const myTeams = (teamsData?.data?.teams || []).filter(
    (t) => t.tournament.key === tournamentKey && ["Pending", "Registered"].includes(t.status),
  );

  const checked = useRef(false);
  useEffect(() => {
    const pending = myTeams.find((t) => t.captain && t.paymentStatus === "Unpaid");
    if (params.get("checkout") !== "done" || checked.current || !pending) return;
    checked.current = true;
    pay.mutate(pending.teamCode, {
      onSuccess: (res) => res?.data?.paid && toast.success("Paid — your entry is in"),
      onSettled: () => {
        params.delete("checkout");
        setParams(params, { replace: true });
      },
    });
  }, [params, setParams, myTeams, pay]);

  const handleRegister = useCallback(
    (division) => {
      setActionError("");
      register.mutate(
        { tournamentKey, divisionKey: division.key, name: teamName.trim() },
        {
          onSuccess: (res) => {
            if (res?.data?.checkoutUrl) window.location.assign(res.data.checkoutUrl);
            else toast.success(res?.message || "Registered");
            setTeamName("");
          },
          onError: (err) => setActionError(errorText(err)),
        },
      );
    },
    [register, tournamentKey, teamName],
  );

  const handlePay = useCallback(
    (team) => {
      setActionError("");
      pay.mutate(team.teamCode, {
        onSuccess: (res) => {
          if (res?.data?.checkoutUrl) window.location.assign(res.data.checkoutUrl);
          else if (res?.data?.paid) toast.success("Paid");
        },
        onError: (err) => setActionError(errorText(err)),
      });
    },
    [pay],
  );

  const handleCopyInvite = useCallback(async (team) => {
    const ok = await copyText(team.inviteUrl);
    if (ok) toast.success("Invite copied — send it to your partner");
    else toast.error("Couldn't copy the invite");
  }, []);

  const handleWithdraw = useCallback(
    async (team) => {
      const paid = team.paymentStatus === "Paid";
      const ok = await confirm({
        title: "Withdraw your team?",
        description: paid ? `Your ${formatPeso(team.price)} entry fee is refunded to the account you paid with.` : "Your place goes to someone else.",
        confirmText: "Withdraw",
        cancelText: "Stay in",
        danger: true,
      });
      if (!ok) return;
      setActionError("");
      withdraw.mutate(team.teamCode, {
        onSuccess: (res) => toast.success(res?.data?.refunded ? `Withdrawn — ${formatPeso(res.data.refunded)} is on its way back` : "Withdrawn"),
        onError: (err) => setActionError(errorText(err)),
      });
    },
    [withdraw],
  );

  const t = raw?.tournament;
  return {
    signedIn,
    profileRedirect,
    returnPath,
    tournament: t && {
      name: decodeHTML(t.name),
      description: decodeHTML(t.description || ""),
      when: `${dateRange(t.startDate, t.endDate)} · ${t.dailyStart}–${t.dailyEnd === "24:00" ? "midnight" : t.dailyEnd}`,
      venue: decodeHTML(t.venueName),
      address: decodeHTML(t.address || ""),
      directionsUrl: t.directionsUrl,
      courts: t.courts.map(decodeHTML).join(", "),
      registrationOpen: t.registrationOpen,
      closes: dayjs(t.registrationClosesAt).format("ddd, MMM D, h:mm A"),
      status: t.status,
    },
    divisions: raw?.divisions || [],
    myTeams,
    inDivision: (division) => myTeams.some((m) => m.divisionName === division.name),
    teamName,
    handleTeamName: setTeamName,
    handleRegister,
    handlePay,
    handleCopyInvite,
    handleWithdraw,
    isRegistering: register.isPending,
    isPaying: pay.isPending,
    actionError,
    isLoading,
    isFetching,
    notFound: error?.response?.status === 404,
    loadError: error && error?.response?.status !== 404 ? error : null,
    refetch,
  };
};
