import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import dayjs from "dayjs";
import { toast } from "sonner";
import { Copy, Eye } from "lucide-react";

import RowActions from "../../../../components/RowActions";
import StatusDot from "../../../../components/StatusDot";
import { usePermissions } from "../../../../hooks/usePermissions";
import { copyText } from "../../../../utils/clipboard";
import { decodeHTML } from "../../../../utils/decode-html";
import { useGetTournaments } from "../../../../services/requests/admin/tournaments";

export const TOURNAMENT_TONE = {
  Draft: "muted",
  Open: "success",
  Closed: "warning",
  Live: "success",
  Finished: "muted",
  Cancelled: "error",
};

/** "Dec 12" / "Dec 12 – 13" / "Dec 30 – Jan 2". */
export const dateRange = (start, end) => {
  const a = dayjs(start);
  const b = dayjs(end);
  if (a.isSame(b, "day")) return a.format("ddd, MMM D");
  return a.isSame(b, "month") ? `${a.format("MMM D")} – ${b.format("D")}` : `${a.format("MMM D")} – ${b.format("MMM D")}`;
};

/**
 * PLAN-009 phase E — DGSports → Tournaments: the company's events, newest first,
 * and the New tournament drawer. A row opens the tournament's page.
 */
export const useTournamentsHooks = () => {
  const { hasPermission } = usePermissions();
  const canWrite = hasPermission("tournaments", null, "write");
  const navigate = useNavigate();
  const [status, setStatus] = useState("");
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20 });
  const [formOpen, setFormOpen] = useState(false);

  const { data, isLoading, isFetching, error, refetch } = useGetTournaments({
    status: status || undefined,
    page: pagination.current,
    pageSize: pagination.pageSize,
  });
  const tournaments = data?.data?.tournaments || [];
  const total = data?.data?.pagination?.total || 0;

  const open = useCallback((t) => navigate(`/admin/dyna-cam/tournaments/${t.tournamentId}`), [navigate]);
  const copyLink = useCallback(async (t) => {
    const ok = await copyText(t.shareUrl);
    if (ok) toast.success("Link copied — share it with players");
    else toast.error("Couldn't copy the link");
  }, []);

  const columns = useMemo(
    () => [
      {
        title: "Tournament",
        key: "name",
        render: (_, t) => (
          <button type="button" onClick={() => open(t)} className="min-w-0 text-left cursor-pointer hover:underline">
            <div className="truncate" style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-dark)" }}>
              {decodeHTML(t.name)}
            </div>
            <div className="truncate" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
              {decodeHTML(t.venueName)}
            </div>
          </button>
        ),
      },
      {
        title: "When",
        key: "when",
        width: 170,
        render: (_, t) => <span style={{ fontSize: 13.5 }}>{dateRange(t.startDate, t.endDate)}</span>,
      },
      {
        title: "Registration",
        key: "registration",
        width: 200,
        render: (_, t) => (
          <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
            {t.registrationOpen ? `Open until ${dayjs(t.registrationClosesAt).format("MMM D, h:mm A")}` : "Not open"}
          </span>
        ),
      },
      {
        title: "Teams",
        key: "teams",
        width: 120,
        render: (_, t) => (
          <span className="font-mono" style={{ fontSize: 13 }}>
            {t.teams} · {t.divisions} div.
          </span>
        ),
      },
      {
        title: "Status",
        key: "status",
        width: 120,
        render: (_, t) => <StatusDot tone={TOURNAMENT_TONE[t.status]}>{t.status}</StatusDot>,
      },
      {
        title: "",
        key: "actions",
        width: 56,
        render: (_, t) => (
          <RowActions
            items={[
              { key: "open", label: "Open", icon: <Eye className="w-4 h-4" />, onClick: () => open(t) },
              { key: "copy", label: "Copy player link", icon: <Copy className="w-4 h-4" />, onClick: () => copyLink(t) },
            ]}
          />
        ),
      },
    ],
    [open, copyLink],
  );

  return {
    canWrite,
    status,
    handleStatus: (v) => {
      setStatus(v);
      setPagination((p) => ({ ...p, current: 1 }));
    },
    tournaments,
    columns,
    pagination: { ...pagination, total },
    handleTableChange: (next) => setPagination({ current: next.current, pageSize: next.pageSize }),
    isLoading,
    isFetching,
    error,
    refetch,
    formOpen,
    handleNew: () => setFormOpen(true),
    handleFormClose: () => setFormOpen(false),
    handleCreated: (made) => {
      setFormOpen(false);
      if (made?.tournamentId) navigate(`/admin/dyna-cam/tournaments/${made.tournamentId}`);
    },
  };
};
