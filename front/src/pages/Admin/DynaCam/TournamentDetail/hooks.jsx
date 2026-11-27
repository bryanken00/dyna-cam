import { useCallback, useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";

import { usePermissions } from "../../../../hooks/usePermissions";
import { confirm } from "../../../../store/confirmStore";
import { copyText } from "../../../../utils/clipboard";
import { decodeHTML } from "../../../../utils/decode-html";
import {
  useCancelTournament,
  useGetTournament,
  useSetTournamentStatus,
} from "../../../../services/requests/admin/tournaments";

/** The next statuses staff can move a tournament to, with their button words. */
const NEXT = {
  Draft: [{ status: "Open", label: "Open registration" }],
  Open: [
    { status: "Closed", label: "Close registration" },
    { status: "Live", label: "Start the tournament" },
  ],
  Closed: [
    { status: "Open", label: "Reopen registration" },
    { status: "Live", label: "Start the tournament" },
  ],
  Live: [{ status: "Finished", label: "Finish" }],
};

/**
 * PLAN-009 phase E — one tournament's page: its status, divisions with their
 * teams, the draw, and matches.
 */
export const useTournamentDetailHooks = () => {
  const { tournamentId } = useParams();
  const { hasPermission } = usePermissions();
  const canWrite = hasPermission("tournaments", null, "write");
  const canRefund = canWrite && hasPermission("payments", null, "write");
  const { data, isLoading, error, refetch, isFetching } = useGetTournament(tournamentId);
  const statusMutation = useSetTournamentStatus();
  const cancelMutation = useCancelTournament();
  const [editOpen, setEditOpen] = useState(false);
  const [divisionOpen, setDivisionOpen] = useState(false);
  const [division, setDivision] = useState(null);

  const tournament = data?.data?.tournament || null;
  const divisions = data?.data?.divisions || [];
  const editable = tournament && ["Draft", "Open", "Closed"].includes(tournament.status);

  const handleCopy = useCallback(async () => {
    const ok = await copyText(tournament.shareUrl);
    if (ok) toast.success("Link copied — share it with players");
    else toast.error("Couldn't copy the link");
  }, [tournament]);

  const handleStatus = useCallback(
    (status) => statusMutation.mutate({ tournamentId, data: { status } }),
    [statusMutation, tournamentId],
  );

  const handleCancel = useCallback(async () => {
    const ok = await confirm({
      title: "Cancel this tournament?",
      description: `${decodeHTML(tournament.name)}: every team is withdrawn and paid entries are refunded in full. Its courts can be booked again.`,
      confirmText: "Cancel tournament",
      cancelText: "Keep it",
      danger: true,
    });
    if (ok) cancelMutation.mutate({ tournamentId, data: {} });
  }, [cancelMutation, tournament, tournamentId]);

  return {
    canWrite,
    canRefund,
    tournament,
    divisions,
    editable,
    nextSteps: tournament ? NEXT[tournament.status] || [] : [],
    isLoading,
    isFetching,
    error,
    refetch,
    handleCopy,
    handleStatus,
    handleCancel,
    busy: statusMutation.isPending || cancelMutation.isPending,
    editOpen,
    handleEdit: () => setEditOpen(true),
    handleEditClose: () => setEditOpen(false),
    divisionOpen,
    division,
    handleNewDivision: () => {
      setDivision(null);
      setDivisionOpen(true);
    },
    handleEditDivision: (d) => {
      setDivision(d);
      setDivisionOpen(true);
    },
    handleDivisionClose: () => {
      setDivisionOpen(false);
      setDivision(null);
    },
  };
};
