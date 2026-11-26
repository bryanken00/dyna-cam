import { useCallback, useMemo, useState } from "react";
import dayjs from "dayjs";
import { KeyRound, Pause, Pencil, Play } from "lucide-react";

import RowActions from "../../../components/RowActions";
import { confirm } from "../../../store/confirmStore";
import {
  useDeactivateAdmin,
  useGetAdmins,
  useReactivateAdmin,
  useResetAdminPassword,
} from "../../../services/requests/backoffice/admins";
import { decodeHTML } from "../../../utils/decode-html";

const fullName = (a) => `${decodeHTML(a.firstName)} ${decodeHTML(a.lastName)}`;

/**
 * PLAN-008 phase E: the back office's Super admins page — list, add (drawer), rename,
 * deactivate / reactivate and reset a password (the temporary one shown once). You
 * can't deactivate or reset yourself (use Your account), and the API keeps at least
 * one active super admin.
 */
export const useAdminsPage = () => {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [shownPassword, setShownPassword] = useState(null);

  const { data, isLoading, isFetching, error, refetch } = useGetAdmins();
  const deactivateMutation = useDeactivateAdmin();
  const reactivateMutation = useReactivateAdmin();
  const resetMutation = useResetAdminPassword();
  const admins = useMemo(() => data?.data?.admins || [], [data]);

  const handleCreate = useCallback(() => {
    setSelected(null);
    setDrawerOpen(true);
  }, []);
  const handleEdit = useCallback((record) => {
    setSelected(record);
    setDrawerOpen(true);
  }, []);
  const handleDrawerClose = useCallback(() => {
    setDrawerOpen(false);
    setSelected(null);
  }, []);
  const handleDrawerSuccess = useCallback(
    (response) => {
      if (!selected && response?.data?.temporaryPassword) {
        setShownPassword({ email: response.data.email, password: response.data.temporaryPassword });
      }
      handleDrawerClose();
    },
    [selected, handleDrawerClose],
  );

  const handleDeactivate = useCallback(
    async (record) => {
      const ok = await confirm({
        title: "Deactivate super admin",
        description: `Deactivate ${fullName(record)}? They're signed out now and can't sign in to the back office until reactivated.`,
        confirmText: "Deactivate",
        cancelText: "Cancel",
        danger: true,
      });
      if (ok) deactivateMutation.mutate(record.platformAdminId);
    },
    [deactivateMutation],
  );
  const handleReactivate = useCallback(
    (record) => reactivateMutation.mutate(record.platformAdminId),
    [reactivateMutation],
  );
  const handleReset = useCallback(
    async (record) => {
      const ok = await confirm({
        title: "Reset password",
        description: `${fullName(record)} gets a new temporary password (shown once) and is signed out everywhere.`,
        confirmText: "Reset password",
        cancelText: "Cancel",
        danger: true,
      });
      if (!ok) return;
      resetMutation.mutate(record.platformAdminId, {
        onSuccess: (response) =>
          setShownPassword({ email: response.data.email, password: response.data.temporaryPassword }),
      });
    },
    [resetMutation],
  );

  const getActionItems = useCallback(
    (record) => {
      const items = [{ key: "edit", label: "Edit name", icon: <Pencil className="w-4 h-4" />, onClick: () => handleEdit(record) }];
      if (record.isSelf) return items;
      items.push(
        { key: "reset", label: "Reset password", icon: <KeyRound className="w-4 h-4" />, onClick: () => handleReset(record) },
        { type: "divider" },
        record.status === "Active"
          ? {
              key: "deactivate",
              label: "Deactivate",
              icon: <Pause className="w-4 h-4" />,
              danger: true,
              onClick: () => handleDeactivate(record),
            }
          : { key: "reactivate", label: "Reactivate", icon: <Play className="w-4 h-4" />, onClick: () => handleReactivate(record) },
      );
      return items;
    },
    [handleEdit, handleReset, handleDeactivate, handleReactivate],
  );

  const columns = useMemo(
    () => [
      {
        title: "Super admin",
        key: "name",
        render: (_, record) => (
          <div className="min-w-0">
            <div className="truncate" style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-dark)" }}>
              {fullName(record)}
              {record.isSelf && (
                <span className="ml-2" style={{ fontSize: 11.5, color: "var(--color-text-muted)" }}>
                  you
                </span>
              )}
            </div>
            <div className="truncate" style={{ fontSize: 12.5, color: "var(--color-text-secondary)" }}>
              {record.email}
            </div>
          </div>
        ),
      },
      {
        title: "Password",
        key: "password",
        width: 170,
        render: (_, record) => (
          <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
            {record.mustChangePassword ? "Temporary" : "Chosen"}
          </span>
        ),
      },
      {
        title: "Last sign-in",
        key: "lastSignInAt",
        width: 190,
        render: (_, record) => (
          <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
            {record.lastSignInAt ? dayjs(record.lastSignInAt).format("MMM D, YYYY h:mm A") : "Never"}
          </span>
        ),
      },
      {
        title: "Status",
        dataIndex: "status",
        key: "status",
        width: 130,
        render: (status) => {
          const active = status === "Active";
          return (
            <span className="inline-flex items-center gap-2" style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: active ? "var(--color-success)" : "var(--color-text-muted)",
                }}
              />
              {status}
            </span>
          );
        },
      },
      {
        title: "",
        key: "actions",
        width: 60,
        align: "right",
        render: (_, record) => <RowActions items={getActionItems(record)} />,
      },
    ],
    [getActionItems],
  );

  return {
    data: admins,
    stats: {
      active: admins.filter((a) => a.status === "Active").length,
      inactive: admins.filter((a) => a.status === "Inactive").length,
    },
    isLoading,
    isFetching,
    error,
    refetch,
    columns,
    drawerOpen,
    selected,
    handleCreate,
    handleDrawerClose,
    handleDrawerSuccess,
    shownPassword,
    handleClosePassword: () => setShownPassword(null),
  };
};
