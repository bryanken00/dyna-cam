import { useState } from "react";
import { CircleAlert, Filter, KeyRound, Smartphone, Wifi } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePairedAppHooks } from "./hooks";
import PairAppFormDrawer from "./components/PairAppFormDrawer";
import PageHeader from "../../../../components/PageHeader";
import PaginationFooter from "../../../../components/PaginationFooter";
import StatCard from "../../../../components/StatCard";
import RefreshButton from "../../../../components/RefreshButton";
import SearchableSelect from "../../../../components/SearchableSelect";
import DataTable from "../../../../components/DataTable";
import FilterField from "../../../../components/FilterField";
import PairingKeyDialog from "../../../../components/PairingKeyDialog";
import PendingPairingKeys from "../../../../components/PendingPairingKeys";

const ALL = "all";

/** Dyna Cam → Paired Apps: staff phones paired to a venue with a 6-digit key. */
const PairedAppsPage = () => {
  const {
    data,
    pagination,
    filters,
    isLoading,
    isFetching,
    error,
    refetch,
    canWrite,
    venueOptions,
    columns,
    handleTableChange,
    handleFilterChange,
    handleClearFilters,
    drawerOpen,
    selectedApp,
    handleCreate,
    handleDrawerClose,
    handleDrawerSuccess,
    pairingKey,
    handlePairingDialogClose,
  } = usePairedAppHooks();

  const [isFilterVisible, setIsFilterVisible] = useState(false);

  const totalApps = pagination?.total || 0;
  const paired = data?.filter((a) => a.status === "Active").length || 0;
  const inUse =
    data?.filter(
      (a) =>
        a.status === "Active" &&
        a.lastSeenSecondsAgo !== null &&
        a.lastSeenSecondsAgo < 5 * 60,
    ).length || 0;

  const hasActiveFilters = Boolean(filters.venueId || filters.status);
  const isEmpty = !isLoading && (data?.length || 0) === 0;

  if (error) {
    return (
      <div className="p-8">
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Error loading paired phones</AlertTitle>
          <AlertDescription>
            {error.message || "Failed to load paired phones. Please try again."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-5">
      {/* 1. HEADER */}
      <PageHeader
        title="Paired Apps"
        subtitle="Staff phones paired to a venue with a 6-digit key. They open straight to that venue's courts — no login."
        actions={
          canWrite && (
            <Button onClick={handleCreate}>
              <KeyRound />
              Pair a phone
            </Button>
          )
        }
      />

      {/* 2. STAT CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
        <StatCard
          title={hasActiveFilters ? "Matching phones" : "Phones"}
          value={totalApps}
          change={hasActiveFilters ? "with these filters" : "all venues"}
          icon={<Smartphone className="w-4.25 h-4.25" strokeWidth={1.8} />}
        />
        <StatCard
          title="Paired"
          value={paired}
          change="on this page"
          icon={<KeyRound className="w-4.25 h-4.25" strokeWidth={1.8} />}
        />
        <StatCard
          title="In use now"
          value={inUse}
          change="seen in the last 5 min"
          icon={<Wifi className="w-4.25 h-4.25" strokeWidth={1.8} />}
        />
      </div>

      {/* Keys created but not used yet */}
      <PendingPairingKeys
        kind="apps"
        canWrite={canWrite}
        refetchInterval={pairingKey ? 10 * 1000 : 60 * 1000}
      />

      {/* 3. TABLE CARD */}
      <div
        className="bg-surface overflow-hidden"
        style={{
          border: "1px solid var(--color-line)",
          borderRadius: "var(--radius-card)",
        }}
      >
        <div
          className="flex items-center justify-between gap-3 flex-wrap px-4.5 py-3.5"
          style={{ borderBottom: "1px solid var(--color-line)" }}
        >
          <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
            Newest first
          </span>
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
            <FilterField label="Venue">
              <SearchableSelect
                className="w-56"
                value={filters.venueId || ALL}
                onValueChange={(v) => handleFilterChange("venueId", v === ALL ? "" : v)}
                options={[{ value: ALL, label: "All venues" }, ...venueOptions]}
              />
            </FilterField>
            <FilterField label="Status">
              <Select
                value={filters.status || ALL}
                onValueChange={(v) => handleFilterChange("status", v === ALL ? "" : v)}
              >
                <SelectTrigger className="h-10 w-44">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All statuses</SelectItem>
                  <SelectItem value="Active">Paired</SelectItem>
                  <SelectItem value="Revoked">Unpaired</SelectItem>
                  <SelectItem value="Deleted">Deleted</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
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
            <p style={{ fontSize: 13.5, color: "var(--color-text-muted)" }}>
              {hasActiveFilters
                ? "No phones match these filters"
                : "No phones paired yet"}
            </p>
            {canWrite && !hasActiveFilters && (
              <Button onClick={handleCreate}>
                <KeyRound />
                Pair a phone
              </Button>
            )}
          </div>
        ) : (
          <>
            <DataTable
              dataSource={data}
              columns={columns}
              rowKey="pairedAppId"
              loading={isLoading}
              scroll={{ x: 820 }}
            />
            <PaginationFooter
              pagination={pagination}
              onChange={handleTableChange}
              noun="phone"
            />
          </>
        )}
      </div>

      {/* 4. DRAWER / DIALOG */}
      <PairAppFormDrawer
        open={drawerOpen}
        entity={selectedApp}
        onClose={handleDrawerClose}
        onSuccess={handleDrawerSuccess}
      />
      <PairingKeyDialog
        key={pairingKey?.code || "none"}
        open={!!pairingKey}
        kind="app"
        pairingKey={pairingKey}
        onClose={handlePairingDialogClose}
      />
    </div>
  );
};

export default PairedAppsPage;
