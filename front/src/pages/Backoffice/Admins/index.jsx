import { CircleAlert, CirclePause, Plus, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import DataTable from "../../../components/DataTable";
import PageHeader from "../../../components/PageHeader";
import RefreshButton from "../../../components/RefreshButton";
import StatCard from "../../../components/StatCard";
import TemporaryPasswordDialog from "../Companies/components/TemporaryPasswordDialog";
import AdminFormDrawer from "./components/AdminFormDrawer";
import { useAdminsPage } from "./hooks";

const ICON = { className: "w-4.25 h-4.25", strokeWidth: 1.8 };

/** PLAN-008 phase E: DGSports' super admins — who can use the back office. */
const AdminsPage = () => {
  const {
    data,
    stats,
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
    handleClosePassword,
  } = useAdminsPage();

  if (error) {
    return (
      <div className="p-4 sm:p-8">
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Error loading super admins</AlertTitle>
          <AlertDescription>{error.response?.data?.message || error.message}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8 space-y-5">
      <PageHeader
        title="Super admins"
        subtitle="DGSports people who can use the back office. Each can manage every company and the others here."
        actions={
          <Button onClick={handleCreate}>
            <Plus />
            Add super admin
          </Button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        <StatCard title="Active" value={stats.active} change="can sign in" icon={<ShieldCheck {...ICON} />} />
        <StatCard title="Deactivated" value={stats.inactive} change="can't sign in" icon={<CirclePause {...ICON} />} />
      </div>

      <div className="bg-surface overflow-hidden" style={{ border: "1px solid var(--color-line)", borderRadius: "var(--radius-card)" }}>
        <div
          className="flex items-center justify-end gap-3 px-4.5 py-3.5"
          style={{ borderBottom: "1px solid var(--color-line)" }}
        >
          <RefreshButton onRefresh={refetch} isFetching={isFetching} />
        </div>
        <DataTable dataSource={data} columns={columns} rowKey="platformAdminId" loading={isLoading} scroll={{ x: 760 }} />
      </div>

      <AdminFormDrawer open={drawerOpen} entity={selected} onClose={handleDrawerClose} onSuccess={handleDrawerSuccess} />
      <TemporaryPasswordDialog
        open={!!shownPassword}
        onClose={handleClosePassword}
        email={shownPassword?.email}
        password={shownPassword?.password}
        title="Their temporary password"
        signInPath="/backoffice"
      />
    </div>
  );
};

export default AdminsPage;
