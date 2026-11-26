import { useState } from "react";
import { Building2, CircleAlert, CirclePause, CircleCheck, Filter, Plus } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import DataTable from "../../../components/DataTable";
import PageHeader from "../../../components/PageHeader";
import PaginationFooter from "../../../components/PaginationFooter";
import RefreshButton from "../../../components/RefreshButton";
import SearchInput from "../../../components/SearchInput";
import StatCard from "../../../components/StatCard";
import CompanyFormDrawer from "./components/CompanyFormDrawer";
import TemporaryPasswordDialog from "./components/TemporaryPasswordDialog";
import { useCompaniesPage } from "./hooks";

const ICON = { className: "w-4.25 h-4.25", strokeWidth: 1.8 };

/** PLAN-008 phase B: every company on DGSports — onboard, edit, suspend. */
const CompaniesPage = () => {
  const {
    data,
    stats,
    pagination,
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
  } = useCompaniesPage();
  const [isFilterVisible, setIsFilterVisible] = useState(false);
  const hasActiveFilters = Boolean(filters.search || filters.status);
  const isEmpty = !isLoading && data.length === 0;

  if (error) {
    return (
      <div className="p-4 sm:p-8">
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Error loading companies</AlertTitle>
          <AlertDescription>{error.response?.data?.message || error.message}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8 space-y-5">
      <PageHeader
        title="Companies"
        subtitle="Every client on DGSports. Each company's staff see only their own venues and data."
        actions={
          <Button onClick={handleCreate}>
            <Plus />
            Onboard company
          </Button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <StatCard
          title="Companies"
          value={stats.active + stats.suspended}
          change="all"
          icon={<Building2 {...ICON} />}
        />
        <StatCard title="Active" value={stats.active} change="can sign in and take bookings" icon={<CircleCheck {...ICON} />} />
        <StatCard title="Suspended" value={stats.suspended} change="signed out, no online booking" icon={<CirclePause {...ICON} />} />
      </div>

      <div
        className="bg-surface overflow-hidden"
        style={{ border: "1px solid var(--color-line)", borderRadius: "var(--radius-card)" }}
      >
        <div
          className="flex items-center justify-between gap-3 flex-wrap px-4.5 py-3.5"
          style={{ borderBottom: "1px solid var(--color-line)" }}
        >
          <SearchInput value={filters.search} onChange={handleSearch} placeholder="Find a company…" />
          <div className="flex items-center gap-2">
            <RefreshButton onRefresh={refetch} isFetching={isFetching} />
            <Button
              variant={isFilterVisible || hasActiveFilters ? "default" : "outline"}
              size="sm"
              onClick={() => setIsFilterVisible(!isFilterVisible)}
            >
              <Filter />
              Filters
            </Button>
          </div>
        </div>

        {isFilterVisible && (
          <div
            className="flex items-end gap-3 flex-wrap px-4.5 py-3.5"
            style={{ borderBottom: "1px solid var(--color-line)" }}
          >
            <div className="flex flex-col gap-1.5">
              <span
                className="uppercase"
                style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: "var(--color-text-muted)" }}
              >
                Status
              </span>
              <Select value={filters.status || "all"} onValueChange={(v) => handleStatusFilter(v === "all" ? "" : v)}>
                <SelectTrigger className="h-10 w-50">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Suspended">Suspended</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {hasActiveFilters && (
              <button
                onClick={handleClearFilters}
                className="h-8 text-[13px] cursor-pointer hover:underline"
                style={{ color: "var(--color-link)" }}
              >
                Clear all
              </button>
            )}
          </div>
        )}

        {isEmpty ? (
          <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
            <p style={{ fontSize: 13.5, color: "var(--color-text-muted)" }}>No companies found</p>
            <Button onClick={handleCreate}>
              <Plus />
              Onboard company
            </Button>
          </div>
        ) : (
          <>
            <DataTable dataSource={data} columns={columns} rowKey="companyId" loading={isLoading} scroll={{ x: 1000 }} />
            <PaginationFooter pagination={pagination} onChange={handleTableChange} noun="company" nounPlural="companies" />
          </>
        )}
      </div>

      <CompanyFormDrawer open={drawerOpen} entity={selected} onClose={handleDrawerClose} onSuccess={handleDrawerSuccess} />
      <TemporaryPasswordDialog
        open={!!shownPassword}
        onClose={handleClosePassword}
        email={shownPassword?.email}
        password={shownPassword?.password}
        welcomeSent={shownPassword?.welcomeSent}
      />
    </div>
  );
};

export default CompaniesPage;
