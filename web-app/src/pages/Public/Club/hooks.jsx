import { useCallback, useState } from "react";
import { useParams } from "react-router";
import dayjs from "dayjs";
import { toast } from "sonner";

import { confirm } from "../../../store/confirmStore";
import { usePlayerSignedIn } from "../../../store/playerStore";
import { decodeHTML } from "../../../utils/decode-html";
import { formatPeso, formatTimeRange } from "../../../utils/dynaCam";
import { spotsText } from "../../../utils/openPlay";
import { useGetClub, useGetMyClubs, useJoinClub, useLeaveClub } from "../../../services/requests/public/clubs";
import { useProfileRedirect } from "../../../services/requests/public/player";

/** `/clubs/:clubKey` (PLAN-009 phase F): a club — join or leave, its members and sessions. */
export const useClubHooks = () => {
  const { clubKey } = useParams();
  const signedIn = usePlayerSignedIn();
  const returnPath = `/clubs/${clubKey}`;
  const profileRedirect = useProfileRedirect(returnPath);
  const { data, isLoading, error } = useGetClub(clubKey);
  const { data: mineData } = useGetMyClubs();
  const join = useJoinClub();
  const leave = useLeaveClub();
  const [actionError, setActionError] = useState("");
  const raw = data?.data?.club;
  const mine = (mineData?.data?.clubs || []).find((c) => c.key === clubKey) || null;

  const handleJoin = useCallback(() => {
    setActionError("");
    join.mutate(clubKey, {
      onSuccess: (res) => toast.success(res?.message || "Joined"),
      onError: (err) => setActionError(err?.response?.data?.message || "Couldn't join — please try again."),
    });
  }, [join, clubKey]);

  const handleLeave = useCallback(async () => {
    const ok = await confirm({ title: "Leave the club?", description: "You can join again later.", confirmText: "Leave", cancelText: "Stay", danger: true });
    if (!ok) return;
    leave.mutate(clubKey, { onSuccess: () => toast.success("You left the club") });
  }, [leave, clubKey]);

  return {
    signedIn,
    profileRedirect,
    returnPath,
    club: raw && {
      name: decodeHTML(raw.name),
      description: decodeHTML(raw.description || ""),
      venue: decodeHTML(raw.venue.name),
      approval: raw.joinPolicy === "Approval",
      members: raw.members,
      people: raw.people,
      sessions: raw.sessions.map((s) => ({
        key: s.key,
        to: `/open-play/${s.key}`,
        title: decodeHTML(s.title),
        when: `${dayjs(s.startAt).format("ddd, MMM D")} · ${formatTimeRange(s.startAt, s.endAt)}`,
        line: [s.coachName && `Coach ${decodeHTML(s.coachName)}`, s.pricePerHead > 0 ? formatPeso(s.pricePerHead) : "Free", spotsText(s.spotsLeft)]
          .filter(Boolean)
          .join(" · "),
      })),
    },
    membership: mine?.status || null,
    isLoading,
    notFound: error?.response?.status === 404,
    loadError: error && error?.response?.status !== 404 ? error : null,
    handleJoin,
    handleLeave,
    isJoining: join.isPending,
    actionError,
  };
};
