import { useState } from "react";
import { CircleAlert, Filter, MapPin, Plus, Server, Video } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useVenueHooks } from "./hooks";
import VenueFormDrawer from "./components/VenueFormDrawer";
import VenuePicker from "./components/VenuePicker";
import PageHeader from "../../../../components/PageHeader";
import PaginationFooter from "../../../../components/PaginationFooter";
import StatCard from "../../../../components/StatCard";
import RefreshButton from "../../../../components/RefreshButton";
import SearchInput from "../../../../components/SearchInput";
import DataTable from "../../../../components/DataTable";
import FilterField from "../../../../components/FilterField";

const VenuesPage = () => {
  const {
    data,
    pagination,
    filters,
    isLoading,
    isFetching,
    error,
    refetch,
    canWrite,
    canList,
    columns,
    handleTableChange,
    handleSearch,
    handleStatusFilter,
    handleClearFilters,
    drawerOpen,
    selectedVenue,
    handleCreate,
    handleDrawerClose,
  } = useVenueHooks();

  const [isFilterVisible, setIsFilterVisible] = useState(false);

  const totalVenues = pagination?.total || 0;
  const totalCourts =
    data?.reduce((sum, v) => sum + (Number(v.courtCount) || 0), 0) || 0;
  const totalDevices =
    data?.reduce((sum, v) => sum + (Number(v.deviceCount) || 0), 0) || 0;

  const hasActiveFilters = Boolean(filters.search || filters.status);
  const isEmpty = !isLoading && (data?.length || 0) === 0;

  // Courts access without Venues access: just pick a venue to open
  if (!canList) return <VenuePicker />;

  if (error) {
    return (
      <div className="p-8">
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Error loading venues</AlertTitle>
          <AlertDescription>
            {error.message || "Failed to load venues. Please try again."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-5">
      {/* 1. HEADER */}
      <PageHeader
        title="Venues"
        subtitle="Pickleball venues — open one to set up its courts and cameras."
        actions={
          canWrite && (
            <Button onClick={handleCreate}>
              <Plus />
              New venue
            </Button>
          )
        }
      />

      {/* 2. STAT CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
        <StatCard
          title="Total venues"
          value={totalVenues}
          change="all time"
          icon={<MapPin className="w-4.25 h-4.25" strokeWidth={1.8} />}
        />
        <StatCard
          title="Courts"
          value={totalCourts}
          change="on this page"
          icon={<Video className="w-4.25 h-4.25" strokeWidth={1.8} />}
        />
        <StatCard
          title="Recorder boxes"
          value={totalDevices}
          change="active, on this page"
          icon={<Server className="w-4.25 h-4.25" strokeWidth={1.8} />}
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
            placeholder="Filter venues…"
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
            <FilterField label="Status">
              <Select
                value={filters.status || "all"}
                onValueChange={(v) => handleStatusFilter(v === "all" ? "" : v)}
              >
                <SelectTrigger className="h-10 w-50">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
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
              No venues found
            </p>
            {canWrite && (
              <Button onClick={handleCreate}>
                <Plus />
                New venue
              </Button>
            )}
          </div>
        ) : (
          <>
            <DataTable
              dataSource={data}
              columns={columns}
              rowKey="venueId"
              loading={isLoading}
              scroll={{ x: 1080 }}
            />
            <PaginationFooter
              pagination={pagination}
              onChange={handleTableChange}
              noun="venue"
            />
          </>
        )}
      </div>

      {/* 4. DRAWERS */}
      <VenueFormDrawer
        open={drawerOpen}
        entity={selectedVenue}
        onClose={handleDrawerClose}
        onSuccess={handleDrawerClose}
      />
    </div>
  );
};

export default VenuesPage;
