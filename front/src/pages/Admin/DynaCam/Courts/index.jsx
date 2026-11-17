import { useState } from "react";
import { CircleAlert, Filter, Plus, Radio, Video, Wifi } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCourtHooks } from "./hooks";
import CourtFormDrawer from "./components/CourtFormDrawer";
import PageHeader from "../../../../components/PageHeader";
import PaginationFooter from "../../../../components/PaginationFooter";
import StatCard from "../../../../components/StatCard";
import RefreshButton from "../../../../components/RefreshButton";
import SearchInput from "../../../../components/SearchInput";
import SearchableSelect from "../../../../components/SearchableSelect";
import DataTable from "../../../../components/DataTable";
import FilterField from "../../../../components/FilterField";

const ALL = "all";

const CourtsPage = () => {
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
    selectedCourt,
    handleCreate,
    handleDrawerClose,
  } = useCourtHooks();

  const [isFilterVisible, setIsFilterVisible] = useState(false);

  const totalCourts = pagination?.total || 0;
  const camerasSet = data?.filter((c) => c.camera?.configured).length || 0;
  const recorderOnline = data?.filter((c) => c.recorderOnline).length || 0;

  const hasActiveFilters = Boolean(
    filters.search || filters.venueId || filters.status,
  );
  const isEmpty = !isLoading && (data?.length || 0) === 0;

  if (error) {
    return (
      <div className="p-8">
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Error loading courts</AlertTitle>
          <AlertDescription>
            {error.message || "Failed to load courts. Please try again."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-5">
      {/* 1. HEADER */}
      <PageHeader
        title="Courts"
        subtitle="One camera per court. Print each court's QR sign for players to scan."
        actions={
          canWrite && (
            <Button onClick={handleCreate}>
              <Plus />
              New court
            </Button>
          )
        }
      />

      {/* 2. STAT CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
        <StatCard
          title="Total courts"
          value={totalCourts}
          change="all venues"
          icon={<Radio className="w-4.25 h-4.25" strokeWidth={1.8} />}
        />
        <StatCard
          title="Cameras set up"
          value={camerasSet}
          change="on this page"
          icon={<Video className="w-4.25 h-4.25" strokeWidth={1.8} />}
        />
        <StatCard
          title="Recorder online"
          value={recorderOnline}
          change="on this page"
          icon={<Wifi className="w-4.25 h-4.25" strokeWidth={1.8} />}
        />
      </div>

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
            placeholder="Filter courts or venues…"
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
                  <SelectItem value="Inactive">Inactive</SelectItem>
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
              No courts found
            </p>
            {canWrite && (
              <Button onClick={handleCreate}>
                <Plus />
                New court
              </Button>
            )}
          </div>
        ) : (
          <>
            <DataTable
              dataSource={data}
              columns={columns}
              rowKey="courtId"
              loading={isLoading}
              scroll={{ x: 1050 }}
            />
            <PaginationFooter
              pagination={pagination}
              onChange={handleTableChange}
              noun="court"
            />
          </>
        )}
      </div>

      {/* 4. DRAWERS */}
      <CourtFormDrawer
        open={drawerOpen}
        entity={selectedCourt}
        onClose={handleDrawerClose}
        onSuccess={handleDrawerClose}
      />
    </div>
  );
};

export default CourtsPage;
