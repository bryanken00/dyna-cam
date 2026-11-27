import { useState } from "react";
import dayjs from "dayjs";
import { toast } from "sonner";
import { Link } from "react-router";
import { Ban, CircleAlert, Copy, ListOrdered, Loader2, UserCheck, UserPlus, X } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

import { PLAY_STATE_TONE, levelRange } from "../hooks";
import DescriptionList from "../../../../../components/DescriptionList";
import SectionLabel from "../../../../../components/SectionLabel";
import Spinner from "../../../../../components/Spinner";
import StatusDot from "../../../../../components/StatusDot";
import { usePermissions } from "../../../../../hooks/usePermissions";
import { confirm } from "../../../../../store/confirmStore";
import { copyText } from "../../../../../utils/clipboard";
import { decodeHTML } from "../../../../../utils/decode-html";
import { formatPayCode, formatPeso, formatTimeRange } from "../../../../../utils/dynaCam";
import { formatPhoneDisplay } from "../../../../../utils/phoneFormat";
import {
  useAddWalkIn,
  useCancelSpot,
  useCheckInSpot,
  useGetPlaySession,
} from "../../../../../services/requests/admin/openPlay";

const SPOT_LABEL = {
  Pending: "Paying",
  Confirmed: "In",
  CheckedIn: "Here",
  Cancelled: "Cancelled",
  Expired: "Didn't pay",
};
const SPOT_TONE = { Pending: "warning", Confirmed: "success", CheckedIn: "success", Cancelled: "muted", Expired: "muted" };
const LIVE = ["Pending", "Confirmed", "CheckedIn"];

/**
 * PLAN-009 phase C — one Open Play session: when, where, who's in (check them
 * in, add a walk-in, cancel a spot) and its player link.
 * Props: `{ open, playSessionId, onClose }`.
 */
const PlaySessionSheet = ({ open, playSessionId, onClose }) => {
  const { hasPermission } = usePermissions();
  const canWrite = hasPermission("open_play", null, "write");
  const canRefund = canWrite && hasPermission("payments", null, "write");
  const { data, isLoading, error } = useGetPlaySession(open ? playSessionId : null);
  const session = data?.data?.session;
  const signups = data?.data?.signups || [];
  const checkIn = useCheckInSpot();
  const cancelSpot = useCancelSpot();
  const addWalkIn = useAddWalkIn();
  const [walkInName, setWalkInName] = useState("");

  const running = session && (session.state === "Scheduled" || session.state === "Live");
  const live = signups.filter((s) => LIVE.includes(s.status));
  const gone = signups.filter((s) => !LIVE.includes(s.status));

  const handleCopy = async () => {
    const ok = await copyText(session.shareUrl);
    if (ok) toast.success("Link copied — share it with players");
    else toast.error("Couldn't copy the link");
  };

  const handleWalkIn = (e) => {
    e.preventDefault();
    const name = walkInName.trim();
    if (!name) return;
    addWalkIn.mutate({ playSessionId, body: { name } }, { onSuccess: () => setWalkInName("") });
  };

  const handleCancelSpot = async (spot) => {
    const paid = spot.paymentStatus === "Paid";
    const ok = await confirm({
      title: paid ? "Cancel and refund this spot" : "Cancel this spot",
      description: paid
        ? `${decodeHTML(spot.name)} paid ${formatPeso(spot.price)} online — it's refunded in full to the account they paid with.`
        : `${decodeHTML(spot.name)}'s spot is freed for someone else.`,
      confirmText: paid ? "Cancel and refund" : "Cancel spot",
      cancelText: "Keep it",
      danger: true,
    });
    if (ok) cancelSpot.mutate({ playSignupId: spot.playSignupId, refund: paid });
  };

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" showCloseButton={false} className="w-full gap-0 p-0 sm:max-w-200" style={{ background: "var(--color-surface)" }}>
        <SheetTitle className="sr-only">Open Play session</SheetTitle>
        <SheetDescription className="sr-only">The session's players and actions</SheetDescription>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="flex items-start justify-between gap-3 mb-6">
            <div className="min-w-0">
              <h2 className="m-0 font-semibold leading-tight truncate" style={{ fontSize: 19, color: "var(--color-text-dark)" }}>
                {session ? decodeHTML(session.title) : "Open Play"}
              </h2>
              {session && (
                <p className="m-0 mt-0.5" style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                  {dayjs(session.startAt).format("dddd, MMM D")} · {formatTimeRange(session.startAt, session.endAt)}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="inline-flex items-center justify-center shrink-0 transition-colors hover:bg-(--color-surface-sunken)"
              style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid var(--color-line)", color: "var(--color-text-secondary)" }}
            >
              <X className="w-4.5 h-4.5" />
            </button>
          </div>

          {isLoading ? (
            <Spinner className="py-16" />
          ) : error || !session ? (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle>Couldn't load the session</AlertTitle>
              <AlertDescription>{error?.response?.data?.message || "Please try again."}</AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-7">
              <DescriptionList
                items={[
                  { label: "Status", value: <StatusDot tone={PLAY_STATE_TONE[session.state]}>{session.state}</StatusDot> },
                  { label: "Venue", value: decodeHTML(session.venueName) },
                  { label: "Courts", value: session.courts.map((c) => decodeHTML(c.name)).join(", ") },
                  { label: "Level", value: levelRange(session.minLevel, session.maxLevel) },
                  { label: "Players", value: `${session.spotsTaken} of ${session.capacity}` },
                  { label: "Fee", value: session.pricePerHead > 0 ? `${formatPeso(session.pricePerHead)} per player` : "Free" },
                  ...(session.cancelReason ? [{ label: "Cancelled because", value: decodeHTML(session.cancelReason) }] : []),
                ]}
              />
              <div className="flex gap-2 flex-wrap">
                {/* PLAN-009 phase D: the queue screen */}
                {running && (
                  <Button asChild>
                    <Link to={`/admin/dyna-cam/open-play/${session.playSessionId}/queue`}>
                      <ListOrdered />
                      Run the queue
                    </Link>
                  </Button>
                )}
                <Button variant="outline" onClick={handleCopy}>
                  <Copy />
                  Copy player link
                </Button>
              </div>

              <section>
                <SectionLabel>
                  In this session · {live.length}
                </SectionLabel>
                {canWrite && running && (
                  <form onSubmit={handleWalkIn} className="flex gap-2 mb-3">
                    <Input
                      value={walkInName}
                      onChange={(e) => setWalkInName(e.target.value)}
                      placeholder="Walk-in's name"
                      className="h-10"
                      maxLength={100}
                      aria-label="Walk-in's name"
                    />
                    <Button type="submit" variant="outline" className="h-10 shrink-0" disabled={!walkInName.trim() || addWalkIn.isPending}>
                      {addWalkIn.isPending ? <Loader2 className="animate-spin" /> : <UserPlus />}
                      Add walk-in
                    </Button>
                  </form>
                )}
                {live.length === 0 ? (
                  <p className="m-0" style={{ fontSize: 13.5, color: "var(--color-text-muted)" }}>
                    Nobody has joined yet. Share the player link.
                  </p>
                ) : (
                  <ul className="m-0 p-0 list-none" style={{ border: "1px solid var(--color-line)", borderRadius: 10 }}>
                    {live.map((s, i) => (
                      <li
                        key={s.playSignupId}
                        className="flex items-center justify-between gap-3 px-3.5 py-2.5"
                        style={{ borderTop: i ? "1px solid var(--color-line)" : "none" }}
                      >
                        <span className="min-w-0">
                          <span className="block truncate" style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-dark)" }}>
                            {decodeHTML(s.name)}
                            {s.walkIn && (
                              <span style={{ fontSize: 12, fontWeight: 400, color: "var(--color-text-muted)" }}> · walk-in</span>
                            )}
                          </span>
                          <span className="block truncate" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
                            {[
                              s.skillLevel || "Level not set",
                              s.paymentStatus === "Paid" ? `Paid ${formatPeso(s.price)}` : s.paymentStatus === "Free" ? "Free" : "Not paid yet",
                              s.phone ? formatPhoneDisplay(s.phone) : null,
                              `Spot ${formatPayCode(s.signupCode)}`,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                        <span className="flex items-center gap-2 shrink-0">
                          <StatusDot tone={SPOT_TONE[s.status]}>{SPOT_LABEL[s.status]}</StatusDot>
                          {canWrite && running && s.status === "Confirmed" && (
                            <Button size="sm" variant="outline" onClick={() => checkIn.mutate(s.playSignupId)} disabled={checkIn.isPending}>
                              <UserCheck />
                              Here
                            </Button>
                          )}
                          {canWrite && (s.paymentStatus !== "Paid" || canRefund) && (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={`Cancel ${decodeHTML(s.name)}'s spot`}
                              onClick={() => handleCancelSpot(s)}
                              disabled={cancelSpot.isPending}
                            >
                              <Ban className="w-4 h-4" />
                            </Button>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {gone.length > 0 && (
                <section>
                  <SectionLabel>Left or didn't pay · {gone.length}</SectionLabel>
                  <ul className="m-0 p-0 list-none space-y-1.5">
                    {gone.map((s) => (
                      <li key={s.playSignupId} className="flex items-center justify-between gap-3" style={{ fontSize: 13.5 }}>
                        <span className="truncate" style={{ color: "var(--color-text-secondary)" }}>
                          {decodeHTML(s.name)}
                          {s.paymentStatus === "Refunded" ? " · refunded" : ""}
                          {s.refundFailed ? " · refund failed — see Payments" : ""}
                        </span>
                        <StatusDot tone={SPOT_TONE[s.status]}>{SPOT_LABEL[s.status]}</StatusDot>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default PlaySessionSheet;
