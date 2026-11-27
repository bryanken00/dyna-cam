import { Check, Shield, UserMinus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

import SectionLabel from "../../../../../components/SectionLabel";
import Spinner from "../../../../../components/Spinner";
import StatusDot from "../../../../../components/StatusDot";
import { usePermissions } from "../../../../../hooks/usePermissions";
import { confirm } from "../../../../../store/confirmStore";
import { decodeHTML } from "../../../../../utils/decode-html";
import { formatPhoneDisplay } from "../../../../../utils/phoneFormat";
import { useGetClub, useUpdateClubMember } from "../../../../../services/requests/admin/clubs";

/** PLAN-009 phase F — a club's members: approve who asked, make admins, take people out. Props: `{ open, clubId, onClose }`. */
const ClubMembersSheet = ({ open, clubId, onClose }) => {
  const { hasPermission } = usePermissions();
  const canWrite = hasPermission("clubs", null, "write");
  const { data, isLoading } = useGetClub(open ? clubId : null);
  const update = useUpdateClubMember();
  const club = data?.data?.club;
  const members = data?.data?.members || [];
  const pending = members.filter((m) => m.status === "Pending");
  const active = members.filter((m) => m.status === "Active");

  const remove = async (m) => {
    const ok = await confirm({ title: "Take them out of the club?", description: decodeHTML(m.name), confirmText: "Take out", cancelText: "Keep", danger: true });
    if (ok) update.mutate({ clubMemberId: m.clubMemberId, body: { status: "Removed" } });
  };

  const Row = ({ m, children }) => (
    <li className="flex items-center justify-between gap-3 py-2" style={{ borderTop: "1px solid var(--color-line)" }}>
      <span className="min-w-0">
        <span className="block truncate" style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-dark)" }}>
          {decodeHTML(m.name)}
          {m.role === "Admin" && <span style={{ fontSize: 12, color: "var(--color-link)" }}> · club admin</span>}
        </span>
        <span className="block truncate" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
          {[m.skillLevel || "Level not set", m.phone ? formatPhoneDisplay(m.phone) : null, m.email].filter(Boolean).join(" · ")}
        </span>
      </span>
      <span className="flex items-center gap-1.5 shrink-0">{children}</span>
    </li>
  );

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" showCloseButton={false} className="w-full gap-0 p-0 sm:max-w-160" style={{ background: "var(--color-surface)" }}>
        <SheetTitle className="sr-only">Club members</SheetTitle>
        <SheetDescription className="sr-only">Approve, make admin or take out members</SheetDescription>
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="flex items-start justify-between gap-3">
            <h2 className="m-0 font-semibold" style={{ fontSize: 19, color: "var(--color-text-dark)" }}>
              {club ? decodeHTML(club.name) : "Club"}
            </h2>
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
          ) : (
            <>
              {pending.length > 0 && (
                <section>
                  <SectionLabel>Asked to join · {pending.length}</SectionLabel>
                  <ul className="m-0 p-0 list-none">
                    {pending.map((m) => (
                      <Row key={m.clubMemberId} m={m}>
                        <StatusDot tone="warning">Asked</StatusDot>
                        {canWrite && (
                          <>
                            <Button size="sm" onClick={() => update.mutate({ clubMemberId: m.clubMemberId, body: { status: "Active" } })} disabled={update.isPending}>
                              <Check />
                              Approve
                            </Button>
                            <Button size="icon-sm" variant="ghost" aria-label="Turn down" onClick={() => remove(m)}>
                              <X className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                      </Row>
                    ))}
                  </ul>
                </section>
              )}
              <section>
                <SectionLabel>Members · {active.length}</SectionLabel>
                {active.length === 0 ? (
                  <p className="m-0" style={{ fontSize: 13.5, color: "var(--color-text-muted)" }}>
                    No members yet — share the club's link.
                  </p>
                ) : (
                  <ul className="m-0 p-0 list-none">
                    {active.map((m) => (
                      <Row key={m.clubMemberId} m={m}>
                        {canWrite && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => update.mutate({ clubMemberId: m.clubMemberId, body: { role: m.role === "Admin" ? "Member" : "Admin" } })}
                              disabled={update.isPending}
                            >
                              <Shield />
                              {m.role === "Admin" ? "Not admin" : "Make admin"}
                            </Button>
                            <Button size="icon-sm" variant="ghost" aria-label="Take out" onClick={() => remove(m)}>
                              <UserMinus className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                      </Row>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default ClubMembersSheet;
