import { useCallback, useState } from "react";
import { useParams } from "react-router";

import { confirm } from "../../../store/confirmStore";
import {
  useGenerateEnrollKey,
  useGetCompany,
  useReactivateCompany,
  useResetOwnerPassword,
  useSuspendCompany,
  useTurnOffEnrollKey,
} from "../../../services/requests/backoffice/companies";
import { decodeHTML } from "../../../utils/decode-html";

/**
 * PLAN-008 phase B: one company in the back office — its details, counts and
 * Owner; edit, suspend / reactivate, reset the Owner's password (shown once).
 * Phase F: its recorder-box enroll key (generate / regenerate / turn off — the key
 * shown once) and its boxes.
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
  const generateKeyMutation = useGenerateEnrollKey();
  const turnOffKeyMutation = useTurnOffEnrollKey();
  // Phase F: { enrollKey, createdAt } while the one-time key is on screen
  const [shownEnrollKey, setShownEnrollKey] = useState(null);

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

  // ─── Phase F: the box enroll key ───────────────────────────────────
  const handleGenerateKey = useCallback(async () => {
    if (!company) return;
    const regenerate = company.enrollKey?.on;
    if (regenerate) {
      const ok = await confirm({
        title: "Make a new enroll key",
        description:
          "The current key stops enrolling new boxes right away. Boxes already enrolled keep working. Put the new key in any box you're still setting up.",
        confirmText: "Make new key",
        cancelText: "Cancel",
        danger: true,
      });
      if (!ok) return;
    }
    generateKeyMutation.mutate(company.companyId, {
      onSuccess: (response) => setShownEnrollKey(response?.data || null),
    });
  }, [company, generateKeyMutation]);

  const handleTurnOffKey = useCallback(async () => {
    if (!company) return;
    const ok = await confirm({
      title: "Turn the enroll key off",
      description: `No new recorder boxes can enrol for ${decodeHTML(company.name)} until you make a new key. Boxes already enrolled keep working.`,
      confirmText: "Turn off",
      cancelText: "Cancel",
      danger: true,
    });
    if (ok) turnOffKeyMutation.mutate(company.companyId);
  }, [company, turnOffKeyMutation]);

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
    // Phase F
    handleGenerateKey,
    handleTurnOffKey,
    isChangingKey: generateKeyMutation.isPending || turnOffKeyMutation.isPending,
    shownEnrollKey,
    handleCloseEnrollKey: () => setShownEnrollKey(null),
  };
};
