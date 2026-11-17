import { useState } from "react";
import { CircleAlert, Filter, Plus, Server, Wifi, WifiOff } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDeviceHooks } from "./hooks";
import DeviceFormDrawer from "./components/DeviceFormDrawer";
import DeviceTokenDialog from "./components/DeviceTokenDialog";
import PairingKeyDialog from "../../../../components/PairingKeyDialog";
import PendingPairingKeys from "../../../../components/PendingPairingKeys";
import PageHeader from "../../../../components/PageHeader";
import PaginationFooter from "../../../../components/PaginationFooter";
import StatCard from "../../../../components/StatCard";
import RefreshButton from "../../../../components/RefreshButton";
import SearchInput from "../../../../components/SearchInput";
import SearchableSelect from "../../../../components/SearchableSelect";
import DataTable from "../../../../components/DataTable";
import FilterField from "../../../../components/FilterField";

const ALL = "all";

const DevicesPage = () => {
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
    handleSearch,
    handleVenueFilter,
    handleStatusFilter,
    handleClearFilters,
    drawerOpen,
    selectedDevice,
    handleCreate,
    handleDrawerClose,
    handleDrawerSuccess,
    issuedToken,
    handleTokenDialogClose,
    pairingKey,
    handlePairingDialogClose,
  } = useDeviceHooks();

  const [isFilterVisible, setIsFilterVisible] = useState(false);

  const totalDevices = pagination?.total || 0;
  const online = data?.filter((d) => d.online).length || 0;
  const offline =
    data?.filter((d) => d.status === "Active" && !d.online).length || 0;

  const hasActiveFilters = Boolean(
    filters.search || filters.venueId || filters.status,
  );
  const isEmpty = !isLoading && (data?.length || 0) === 0;

  if (error) {
    return (
      <div className="p-8">
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Error loading recorder boxes</AlertTitle>
          <AlertDescription>
            {error.message || "Failed to load recorder boxes. Please try again."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-5">
      {/* 1. HEADER */}
      <PageHeader
        title="Recorder Boxes"
        subtitle="The on-site boxes that record each venue's court cameras. Add one with a 6-digit pairing key."
        actions={
          canWrite && (
            <Button onClick={handleCreate}>
              <Plus />
              Add box
            </Button>
          )
        }
      />

      {/* 2. STAT CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
        <StatCard
          title="Total boxes"
          value={totalDevices}
          change="all venues"
          icon={<Server className="w-4.25 h-4.25" strokeWidth={1.8} />}
        />
        <StatCard
          title="Online"
          value={online}
          change="on this page"
          icon={<Wifi className="w-4.25 h-4.25" strokeWidth={1.8} />}
        />
        <StatCard
          title="Offline"
          value={offline}
          change="active, on this page"
          icon={<WifiOff className="w-4.25 h-4.25" strokeWidth={1.8} />}
        />
      </div>

      {/* Keys created but not used yet */}
      <PendingPairingKeys
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
        {/* Toolbar */}
        <div
          className="flex items-center justify-between gap-3 flex-wrap px-4.5 py-3.5"
          style={{ borderBottom: "1px solid var(--color-line)" }}
        >
          <SearchInput
            value={filters.search}
            onChange={handleSearch}
            placeholder="Filter boxes or venues…"
          />
          <div className="flex items-center gap-2">
            <RefreshButton onRefresh={refetch} isFetching={isFetching} />
            <Button
              variant={
                isFilterVisible || hasActiveFilters ? "default" : "outline"
              }
              size="sm"
              onClick={() => setIsFilterVisible(!isFilterVisible)}
            >
              <Filter />
              Filters
            </Button>
          </div>
        </div>

        {/* Filter row */}
        {isFilterVisible && (
          <div
            className="flex items-end gap-3 flex-wrap px-4.5 py-3.5"
            style={{ borderBottom: "1px solid var(--color-line)" }}
          >
            <FilterField label="Venue">
              <SearchableSelect
                className="w-60"
                value={filters.venueId || ALL}
                onValueChange={(v) => handleVenueFilter(v === ALL ? "" : v)}
                options={[{ value: ALL, label: "All venues" }, ...venueOptions]}
              />
            </FilterField>
            <FilterField label="Status">
              <Select
                value={filters.status || ALL}
                onValueChange={(v) => handleStatusFilter(v === ALL ? "" : v)}
              >
                <SelectTrigger className="h-10 w-50">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All statuses</SelectItem>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Revoked">Revoked</SelectItem>
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

        {/* Table + custom pagination footer */}
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
            <p style={{ fontSize: 13.5, color: "var(--color-text-muted)" }}>
              No recorder boxes found
            </p>
            {canWrite && (
              <Button onClick={handleCreate}>
                <Plus />
                Add box
              </Button>
            )}
          </div>
        ) : (
          <>
            <DataTable
              dataSource={data}
              columns={columns}
              rowKey="deviceId"
              loading={isLoading}
              scroll={{ x: 1000 }}
            />
            <PaginationFooter
              pagination={pagination}
              onChange={handleTableChange}
              noun="box"
              nounPlural="boxes"
            />
          </>
        )}
      </div>

      {/* 4. DRAWERS / DIALOGS */}
      <DeviceFormDrawer
        open={drawerOpen}
        entity={selectedDevice}
        onClose={handleDrawerClose}
        onSuccess={handleDrawerSuccess}
      />

      <PairingKeyDialog
        key={pairingKey?.code || "none"}
        open={!!pairingKey}
        kind="recorder"
        pairingKey={pairingKey}
        onClose={handlePairingDialogClose}
      />

      <DeviceTokenDialog
        key={issuedToken?.token || "none"}
        open={!!issuedToken}
        deviceName={issuedToken?.deviceName}
        token={issuedToken?.token}
        onClose={handleTokenDialogClose}
      />
    </div>
  );
};

export default DevicesPage;
