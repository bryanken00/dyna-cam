import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Copy, Pencil, Trash2, Users } from "lucide-react";

import RowActions from "../../../../components/RowActions";
import StatusDot from "../../../../components/StatusDot";
import { usePermissions } from "../../../../hooks/usePermissions";
import { confirm } from "../../../../store/confirmStore";
import { copyText } from "../../../../utils/clipboard";
import { decodeHTML } from "../../../../utils/decode-html";
import { useDeleteClub, useGetClubs } from "../../../../services/requests/admin/clubs";

/** PLAN-009 phase F — DGSports → Clubs: the company's clubs, their members and the club drawer. */
export const useClubsHooks = () => {
  const { hasPermission } = usePermissions();
  const canWrite = hasPermission("clubs", null, "write");
  const { data, isLoading, isFetching, error, refetch } = useGetClubs();
  const remove = useDeleteClub();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [membersOf, setMembersOf] = useState(null);
  const clubs = data?.data?.clubs || [];

  const handleCopy = useCallback(async (c) => {
    const ok = await copyText(c.shareUrl);
    if (ok) toast.success("Link copied — share it with players");
    else toast.error("Couldn't copy the link");
  }, []);
  const handleRemove = useCallback(
    async (c) => {
      const ok = await confirm({ title: "Remove this club?", description: `${decodeHTML(c.name)} — its members-only sessions stay.`, confirmText: "Remove", cancelText: "Keep it", danger: true });
      if (ok) remove.mutate(c.clubId);
    },
    [remove],
  );

  const columns = useMemo(
    () => [
      {
        title: "Club",
        key: "name",
        render: (_, c) => (
          <button type="button" onClick={() => setMembersOf(c.clubId)} className="min-w-0 text-left cursor-pointer hover:underline">
            <div className="truncate" style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-dark)" }}>
              {decodeHTML(c.name)}
            </div>
            <div className="truncate" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
              {decodeHTML(c.venueName)}
            </div>
          </button>
        ),
      },
      {
        title: "Joining",
        key: "joinPolicy",
        width: 170,
        render: (_, c) => <span style={{ fontSize: 13 }}>{c.joinPolicy === "Open" ? "Anyone can join" : "Staff approve"}</span>,
      },
      {
        title: "Members",
        key: "members",
        width: 150,
        render: (_, c) => (
          <span className="font-mono" style={{ fontSize: 13 }}>
            {c.members}
            {c.pending ? <span style={{ color: "var(--color-warning)" }}> · {c.pending} asked</span> : ""}
          </span>
        ),
      },
      { title: "Status", key: "status", width: 110, render: (_, c) => <StatusDot tone={c.status === "Active" ? "success" : "muted"}>{c.status}</StatusDot> },
      {
        title: "",
        key: "actions",
        width: 56,
        render: (_, c) => (
          <RowActions
            items={[
              { key: "members", label: "Members", icon: <Users className="w-4 h-4" />, onClick: () => setMembersOf(c.clubId) },
              { key: "copy", label: "Copy player link", icon: <Copy className="w-4 h-4" />, onClick: () => handleCopy(c) },
              ...(canWrite
                ? [
                    { key: "edit", label: "Edit", icon: <Pencil className="w-4 h-4" />, onClick: () => { setEditing(c); setFormOpen(true); } },
                    { type: "divider" },
                    { key: "remove", label: "Remove", icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleRemove(c) },
                  ]
                : []),
            ]}
          />
        ),
      },
    ],
    [canWrite, handleCopy, handleRemove],
  );

  return {
    canWrite,
    clubs,
    columns,
    isLoading,
    isFetching,
    error,
    refetch,
    formOpen,
    editing,
    handleNew: () => {
      setEditing(null);
      setFormOpen(true);
    },
    handleFormClose: () => {
      setFormOpen(false);
      setEditing(null);
    },
    membersOf,
    handleMembersClose: () => setMembersOf(null),
  };
};
