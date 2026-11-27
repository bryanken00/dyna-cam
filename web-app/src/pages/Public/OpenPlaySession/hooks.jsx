import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import dayjs from "dayjs";
import { toast } from "sonner";

import { confirm } from "../../../store/confirmStore";
import { usePlayerSignedIn } from "../../../store/playerStore";
import { copyText } from "../../../utils/clipboard";
import { decodeHTML } from "../../../utils/decode-html";
import { formatPeso, formatTimeRange } from "../../../utils/dynaCam";
import { levelFits, levelRange, spotsText } from "../../../utils/openPlay";
import { getImageUrl } from "../../../utils/upload";
import {
  useCancelPlaySpot,
  useGetMyPlayQueue,
  useGetMyPlaySpots,
  useGetOpenPlaySession,
  useJoinOpenPlay,
  usePayPlaySpot,
} from "../../../services/requests/public/openPlay";
import { useGetPlayerSports, useProfileRedirect } from "../../../services/requests/public/player";

/** An action's error in the player's words. */
const errorText = (err) =>
  err?.response?.data?.message || (err?.response ? "Something went wrong — please try again." : "Couldn't reach DGSports — check your connection.");

/**
 * `/open-play/:playToken` (PLAN-009 phase C): one session — when, where, who's
 * going — and the player's spot: join (free at once, paid through a checkout),
 * pay a held spot, or cancel. Back from the checkout (`?checkout=done`) the
 * spot's payment is checked once.
 */
export const useOpenPlaySessionHooks = () => {
  const { playToken } = useParams();
  const [params, setParams] = useSearchParams();
  const signedIn = usePlayerSignedIn();
  const returnPath = `/open-play/${playToken}`;
  const profileRedirect = useProfileRedirect(returnPath);
  const { data, isLoading, error, refetch, isFetching } = useGetOpenPlaySession(playToken);
  const { data: spotsData } = useGetMyPlaySpots("upcoming");
  const { data: sportsData } = useGetPlayerSports();
  const joinMutation = useJoinOpenPlay();
  const payMutation = usePayPlaySpot();
  const cancelMutation = useCancelPlaySpot();
  const [actionError, setActionError] = useState("");

  const raw = data?.data?.session || null;
  const mine = (spotsData?.data?.spots || []).find((s) => s.session.key === playToken) || null;
  const myLevel = (sportsData?.data?.sports || []).find((s) => s.sport === "Pickleball")?.skillLevel || null;

  const session = raw && {
    title: decodeHTML(raw.title),
    // PLAN-009 phase F: a clinic's coach; members of a club only
    clinic: raw.kind === "Clinic",
    coach: raw.coachName ? decodeHTML(raw.coachName) : "",
    club: raw.club ? { key: raw.club.key, name: decodeHTML(raw.club.name) } : null,
    description: decodeHTML(raw.description || ""),
    day: dayjs(raw.startAt).format("dddd, MMMM D"),
    time: formatTimeRange(raw.startAt, raw.endAt),
    state: raw.cancelled ? "Cancelled" : raw.state,
    venue: decodeHTML(raw.venue.name),
    address: decodeHTML(raw.venue.address || ""),
    logo: getImageUrl(raw.venue.logoUrl),
    directionsUrl: raw.venue.directionsUrl,
    courts: decodeHTML(raw.courts),
    level: levelRange(raw.minLevel, raw.maxLevel),
    levelWarning: myLevel && !levelFits(myLevel, raw.minLevel, raw.maxLevel) ? `This session is for ${levelRange(raw.minLevel, raw.maxLevel)} — you set ${myLevel}.` : "",
    fee: raw.pricePerHead > 0 ? formatPeso(raw.pricePerHead) : "Free",
    paid: raw.pricePerHead > 0,
    payOnline: raw.payOnline,
    spots: spotsText(raw.spotsLeft),
    spotsLine: `${raw.spotsTaken} of ${raw.capacity} going`,
    full: raw.spotsLeft <= 0,
    players: raw.players,
  };
  const open = session && (session.state === "Scheduled" || session.state === "Live");
  // PLAN-009 phase D: while it runs and I'm in, my place in line (or my court)
  const { data: queueData } = useGetMyPlayQueue(mine?.signupCode, session?.state === "Live" && mine?.status !== "Pending");
  const queue = queueData?.data?.queue || null;

  // Back from the checkout: ask once whether it's paid (settles it if so)
  const checked = useRef(false);
  useEffect(() => {
    if (params.get("checkout") !== "done" || checked.current || !mine || mine.status !== "Pending") return;
    checked.current = true;
    payMutation.mutate(mine.signupCode, {
      onSuccess: (response) => {
        if (response?.data?.paid) toast.success("Paid — you're in");
      },
      onSettled: () => {
        params.delete("checkout");
        setParams(params, { replace: true });
      },
    });
  }, [params, setParams, mine, payMutation]);

  const handleJoin = useCallback(() => {
    setActionError("");
    joinMutation.mutate(playToken, {
      onSuccess: (response) => {
        const checkoutUrl = response?.data?.checkoutUrl;
        if (checkoutUrl) window.location.assign(checkoutUrl);
        else toast.success("You're in — see you on court");
      },
      onError: (err) => setActionError(errorText(err)),
    });
  }, [joinMutation, playToken]);

  const handlePay = useCallback(() => {
    if (!mine) return;
    setActionError("");
    payMutation.mutate(mine.signupCode, {
      onSuccess: (response) => {
        if (response?.data?.checkoutUrl) window.location.assign(response.data.checkoutUrl);
        else if (response?.data?.paid) toast.success("Paid — you're in");
      },
      onError: (err) => setActionError(errorText(err)),
    });
  }, [mine, payMutation]);

  const handleCancel = useCallback(async () => {
    if (!mine) return;
    const paid = mine.paymentStatus === "Paid";
    const ok = await confirm({
      title: "Give up your spot?",
      description: paid
        ? `Your ${formatPeso(mine.price)} is refunded to the account you paid with. It can take a few days to show.`
        : "Someone else can take it.",
      confirmText: "Give it up",
      cancelText: "Keep my spot",
      danger: true,
    });
    if (!ok) return;
    setActionError("");
    cancelMutation.mutate(mine.signupCode, {
      onSuccess: (response) =>
        toast.success(response?.data?.refunded ? `Cancelled — ${formatPeso(response.data.refunded)} is on its way back` : "Cancelled"),
      onError: (err) => setActionError(errorText(err)),
    });
  }, [mine, cancelMutation]);

  const handleShare = useCallback(async () => {
    const ok = await copyText(window.location.href.split("?")[0]);
    if (ok) toast.success("Link copied — send it to your friends");
    else toast.error("Couldn't copy the link");
  }, []);

  return {
    signedIn,
    profileRedirect,
    returnPath,
    session,
    open,
    mine,
    queue,
    cancelBy: mine?.cancelBy ? dayjs(mine.cancelBy).format("ddd, MMM D, h:mm A") : "",
    isLoading,
    isFetching,
    notFound: error?.response?.status === 404,
    loadError: error && error?.response?.status !== 404 ? error : null,
    refetch,
    actionError,
    handleJoin,
    handlePay,
    handleCancel,
    handleShare,
    isJoining: joinMutation.isPending,
    isPaying: payMutation.isPending,
    isCancelling: cancelMutation.isPending,
  };
};
