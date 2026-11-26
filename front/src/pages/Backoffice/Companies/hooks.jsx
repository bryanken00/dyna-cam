import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Eye, KeyRound, Pause, Pencil, Play } from "lucide-react";

import RowActions from "../../../components/RowActions";
import CompanyStatus from "./components/CompanyStatus";
import { confirm } from "../../../store/confirmStore";
import {
  useGetCompanies,
  useReactivateCompany,
  useResetOwnerPassword,
  useSuspendCompany,
} from "../../../services/requests/backoffice/companies";
import { decodeHTML } from "../../../utils/decode-html";

const num = (value) => (
  <span className="font-mono" style={{ fontSize: 13, color: "var(--color-text-dark)" }}>
    {value ?? 0}
  </span>
);

/**
 * PLAN-008 phase B: the back office's Companies page — list, search, status
 * filter, onboard (drawer), edit, suspend / reactivate and reset the Owner's
 * password (its temporary password shown once).
 */
export const useCompaniesPage = () => {
  const navigate = useNavigate();
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20 });
  const [filters, setFilters] = useState({ search: "", status: "" });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  // { email, password, welcomeSent } while the one-time password is on screen
  const [shownPassword, setShownPassword] = useState(null);

  const { data, isLoading, isFetching, error, refetch } = useGetCompanies({
    page: pagination.current,
    pageSize: pagination.pageSize,
    search: filters.search,
    status: filters.status,
  });
  const suspendMutation = useSuspendCompany();
  const reactivateMutation = useReactivateCompany();
  const resetMutation = useResetOwnerPassword();

  const handleTableChange = useCallback((next) => {
    setPagination({ current: next.current, pageSize: next.pageSize });
  }, []);
  const handleSearch = useCallback((value) => {
    setFilters((prev) => ({ ...prev, search: value }));
    setPagination((prev) => ({ ...prev, current: 1 }));
  }, []);
  const handleStatusFilter = useCallback((value) => {
    setFilters((prev) => ({ ...prev, status: value }));
    setPagination((prev) => ({ ...prev, current: 1 }));
  }, []);
  const handleClearFilters = useCallback(() => {
    setFilters({ search: "", status: "" });
    setPagination((prev) => ({ ...prev, current: 1 }));
  }, []);

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
  // Onboarded: show the Owner's temporary password once
  const handleDrawerSuccess = useCallback(
    (response) => {
      const owner = response?.data?.owner;
      if (!selected && owner?.temporaryPassword) {
        setShownPassword({
          email: owner.email,
          password: owner.temporaryPassword,
          welcomeSent: response.data.welcomeSent,
        });
      }
      handleDrawerClose();
    },
    [selected, handleDrawerClose],
  );
  const handleClosePassword = useCallback(() => setShownPassword(null), []);

  const handleSuspend = useCallback(
    async (record) => {
      const ok = await confirm({
        title: "Suspend company",
        description: `Suspend ${decodeHTML(record.name)}? Its staff are signed out and can't sign in, and its venues stop taking online bookings. Bookings and games already made stay.`,
        confirmText: "Suspend",
        cancelText: "Cancel",
        danger: true,
      });
      if (ok) suspendMutation.mutate(record.companyId);
    },
    [suspendMutation],
  );
  const handleReactivate = useCallback(
    (record) => reactivateMutation.mutate(record.companyId),
    [reactivateMutation],
  );
  const handleResetOwner = useCallback(
    async (record) => {
      const ok = await confirm({
        title: "Reset the Owner's password",
        description: `${decodeHTML(record.name)}'s Owner gets a new temporary password (shown once) and is signed out everywhere.`,
        confirmText: "Reset password",
        cancelText: "Cancel",
        danger: true,
      });
      if (!ok) return;
      resetMutation.mutate(record.companyId, {
        onSuccess: (response) => {
          const owner = response?.data?.owner;
          if (owner) setShownPassword({ email: owner.email, password: owner.temporaryPassword });
        },
      });
    },
    [resetMutation],
  );

  const getActionItems = useCallback(
    (record) => [
      {
        key: "open",
        label: "Open",
        icon: <Eye className="w-4 h-4" />,
        onClick: () => navigate(`/backoffice/companies/${record.companyId}`),
      },
      { key: "edit", label: "Edit details", icon: <Pencil className="w-4 h-4" />, onClick: () => handleEdit(record) },
      {
        key: "reset",
        label: "Reset Owner's password",
        icon: <KeyRound className="w-4 h-4" />,
        onClick: () => handleResetOwner(record),
      },
      { type: "divider" },
      record.status === "Suspended"
        ? {
            key: "reactivate",
            label: "Reactivate",
            icon: <Play className="w-4 h-4" />,
            onClick: () => handleReactivate(record),
          }
        : {
            key: "suspend",
            label: "Suspend",
            icon: <Pause className="w-4 h-4" />,
            danger: true,
            onClick: () => handleSuspend(record),
          },
    ],
    [navigate, handleEdit, handleResetOwner, handleReactivate, handleSuspend],
  );

  const columns = useMemo(
    () => [
      {
        title: "Company",
        dataIndex: "name",
        key: "name",
        render: (name, record) => (
          <Link to={`/backoffice/companies/${record.companyId}`} className="min-w-0 block hover:underline" style={{ textDecoration: "none" }}>
            <div className="truncate" style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-dark)" }}>
              {decodeHTML(name)}
              {record.isDefault && (
                <span className="ml-2" style={{ fontSize: 11.5, color: "var(--color-text-muted)" }}>
                  default
                </span>
              )}
            </div>
            <div className="truncate font-mono" style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
              {record.slug}
            </div>
          </Link>
        ),
      },
      { title: "Venues", key: "venues", width: 90, align: "right", render: (_, r) => num(r.counts?.venues) },
      { title: "Courts", key: "courts", width: 90, align: "right", render: (_, r) => num(r.counts?.courts) },
      {
        title: "Boxes online",
        key: "boxes",
        width: 120,
        align: "right",
        render: (_, r) => num(`${r.counts?.boxesOnline ?? 0}/${r.counts?.boxes ?? 0}`),
      },
      {
        title: "Bookings · month",
        key: "bookings",
        width: 140,
        align: "right",
        render: (_, r) => num(r.counts?.bookingsThisMonth),
      },
      {
        title: "Games · month",
        key: "games",
        width: 130,
        align: "right",
        render: (_, r) => num(r.counts?.gamesThisMonth),
      },
      { title: "Status", dataIndex: "status", key: "status", width: 130, render: (s) => <CompanyStatus status={s} /> },
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

  // apiData = { success, message, data: { companies, stats, pagination } }
  return {
    data: data?.data?.companies || [],
    stats: data?.data?.stats || { active: 0, suspended: 0 },
    pagination: { ...pagination, total: data?.data?.pagination?.total || 0 },
    filters,
    isLoading,
    isFetching,
    error,
    refetch,
    columns,
    handleTableChange,
    handleSearch,
    handleStatusFilter,
    handleClearFilters,
    drawerOpen,
    selected,
    handleCreate,
    handleDrawerClose,
    handleDrawerSuccess,
    shownPassword,
    handleClosePassword,
  };
};
