import { useCallback, useState } from "react";
import { useParams } from "react-router";

import { confirm } from "../../../store/confirmStore";
import {
  useGetCompany,
  useReactivateCompany,
  useResetOwnerPassword,
  useSuspendCompany,
} from "../../../services/requests/backoffice/companies";
import { decodeHTML } from "../../../utils/decode-html";

/**
 * PLAN-008 phase B: one company in the back office — its details, counts and
 * Owner; edit, suspend / reactivate, reset the Owner's password (shown once).
 */
export const useCompanyDetail = () => {
  const { companyId } = useParams();
  const { data, isLoading, error, refetch, isFetching } = useGetCompany(companyId);
  const company = data?.data?.company || null;

  const [editOpen, setEditOpen] = useState(false);
  const [shownPassword, setShownPassword] = useState(null);
  const suspendMutation = useSuspendCompany();
  const reactivateMutation = useReactivateCompany();
  const resetMutation = useResetOwnerPassword();

  const handleEdit = useCallback(() => setEditOpen(true), []);
  const handleEditClose = useCallback(() => setEditOpen(false), []);

  const handleSuspend = useCallback(async () => {
    if (!company) return;
    const ok = await confirm({
      title: "Suspend company",
      description: `Suspend ${decodeHTML(company.name)}? Its staff are signed out and can't sign in, and its venues stop taking online bookings. Bookings and games already made stay.`,
      confirmText: "Suspend",
      cancelText: "Cancel",
      danger: true,
    });
    if (ok) suspendMutation.mutate(company.companyId);
  }, [company, suspendMutation]);

  const handleReactivate = useCallback(() => {
    if (company) reactivateMutation.mutate(company.companyId);
  }, [company, reactivateMutation]);

  const handleResetOwner = useCallback(async () => {
    if (!company) return;
    const ok = await confirm({
      title: "Reset the Owner's password",
      description: "The Owner gets a new temporary password (shown once) and is signed out everywhere.",
      confirmText: "Reset password",
      cancelText: "Cancel",
      danger: true,
    });
    if (!ok) return;
    resetMutation.mutate(company.companyId, {
      onSuccess: (response) => {
        const owner = response?.data?.owner;
        if (owner) setShownPassword({ email: owner.email, password: owner.temporaryPassword });
      },
    });
  }, [company, resetMutation]);

  return {
    company,
    isLoading,
    isFetching,
    error,
    notFound: error?.response?.status === 404,
    refetch,
    editOpen,
    handleEdit,
    handleEditClose,
    handleSuspend,
    handleReactivate,
    handleResetOwner,
    isChangingStatus: suspendMutation.isPending || reactivateMutation.isPending,
    isResetting: resetMutation.isPending,
    shownPassword,
    handleClosePassword: () => setShownPassword(null),
  };
};
