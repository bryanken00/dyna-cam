import { useState } from "react";
import {
  CalendarClock,
  CalendarPlus,
  CircleAlert,
  Clapperboard,
  Filter,
  Radio,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSessionHooks } from "./hooks";
import SessionFormDrawer from "./components/SessionFormDrawer";
import SessionDetailSheet from "./components/SessionDetailSheet";
import PairDeviceFormModal from "./components/PairDeviceFormModal";
import PairingKeyDialog from "../../../../components/PairingKeyDialog";
import PageHeader from "../../../../components/PageHeader";
import PaginationFooter from "../../../../components/PaginationFooter";
import StatCard from "../../../../components/StatCard";
import RefreshButton from "../../../../components/RefreshButton";
import SearchInput from "../../../../components/SearchInput";
import SearchableSelect from "../../../../components/SearchableSelect";
import DataTable from "../../../../components/DataTable";
import FilterField from "../../../../components/FilterField";

const ALL = "all";
const STATUSES = [
  "Scheduled",
  "Recording",
  "Processing",
  "Ready",
  "Failed",
  "Cancelled",
];

const SessionsPage = () => {
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
    courtOptions,
    columns,
    handleTableChange,
    handleSearch,
    handleFilterChange,
    handleClearFilters,
    drawerOpen,
    handleCreate,
    handleDrawerClose,
    handleDrawerSuccess,
    detailSessionId,
    handleDetailClose,
    pairTarget,
    handlePairDevice,
    handlePairFormClose,
    handlePairFormSuccess,
    pairingKey,
    handlePairingKeyClose,
  } = useSessionHooks();

  const [isFilterVisible, setIsFilterVisible] = useState(false);

  const totalSessions = pagination?.total || 0;
  const recording = data?.filter((s) => s.status === "Recording").length || 0;
  const upcoming = data?.filter((s) => s.status === "Scheduled").length || 0;

  const hasPanelFilters = Boolean(
    filters.venueId || filters.courtId || filters.status,
  );
  const hasActiveFilters = Boolean(filters.search) || hasPanelFilters;
  const isEmpty = !isLoading && (data?.length || 0) === 0;

  if (error) {
    return (
      <div className="p-8">
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Error loading sessions</AlertTitle>
          <AlertDescription>
            {error.message || "Failed to load sessions. Please try again."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-5">
      {/* 1. HEADER */}
      <PageHeader
        title="Sessions"
        subtitle="Book a court to record a whole game, then pair the phone or tablet at the court. Footage arrives in 5-minute parts on the player's link."
        actions={
          canWrite && (
            <Button onClick={handleCreate}>
              <CalendarPlus />
              Book session
            </Button>
          )
        }
      />

      {/* 2. STAT CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
        <StatCard
          title={hasActiveFilters ? "Matching sessions" : "Total sessions"}
          value={totalSessions}
          change={hasActiveFilters ? "with these filters" : "all time"}
          icon={<Clapperboard className="w-4.25 h-4.25" strokeWidth={1.8} />}
        />
        <StatCard
          title="Recording now"
          value={recording}
          change="on this page"
          icon={<Radio className="w-4.25 h-4.25" strokeWidth={1.8} />}
        />
        <StatCard
          title="Upcoming"
          value={upcoming}
          change="on this page"
          icon={<CalendarClock className="w-4.25 h-4.25" strokeWidth={1.8} />}
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
            placeholder="Filter by player, court or venue…"
          />
          <div className="flex items-center gap-2">
            <RefreshButton onRefresh={refetch} isFetching={isFetching} />
            <Button
              variant={isFilterVisible || hasPanelFilters ? "default" : "outline"}
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
                className="w-56"
                value={filters.venueId || ALL}
                onValueChange={(v) =>
                  handleFilterChange("venueId", v === ALL ? "" : v)
                }
                options={[{ value: ALL, label: "All venues" }, ...venueOptions]}
              />
            </FilterField>
            <FilterField label="Court">
              <SearchableSelect
                className="w-56"
                value={filters.courtId || ALL}
                onValueChange={(v) =>
                  handleFilterChange("courtId", v === ALL ? "" : v)
                }
                options={[{ value: ALL, label: "All courts" }, ...courtOptions]}
              />
            </FilterField>
            <FilterField label="Status">
              <Select
                value={filters.status || ALL}
                onValueChange={(v) =>
                  handleFilterChange("status", v === ALL ? "" : v)
                }
              >
                <SelectTrigger className="h-10 w-44">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All statuses</SelectItem>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
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
              {hasActiveFilters
                ? "No sessions match these filters"
                : "No sessions booked yet"}
            </p>
            {canWrite && !hasActiveFilters && (
              <Button onClick={handleCreate}>
                <CalendarPlus />
                Book session
              </Button>
            )}
          </div>
        ) : (
          <>
            <DataTable
              dataSource={data}
              columns={columns}
              rowKey="sessionId"
              loading={isLoading}
              scroll={{ x: 1000 }}
            />
            <PaginationFooter
              pagination={pagination}
              onChange={handleTableChange}
              noun="session"
            />
          </>
        )}
      </div>

      {/* 4. DRAWER / DIALOG / SHEET */}
      <SessionFormDrawer
        open={drawerOpen}
        onClose={handleDrawerClose}
        onSuccess={handleDrawerSuccess}
      />

      <SessionDetailSheet
        open={!!detailSessionId}
        sessionId={detailSessionId}
        canWrite={canWrite}
        onClose={handleDetailClose}
        onPairDevice={handlePairDevice}
      />

      {/* Pair a device: name it, then show its 6-digit key */}
      <PairDeviceFormModal
        open={!!pairTarget}
        entity={pairTarget}
        onClose={handlePairFormClose}
        onSuccess={handlePairFormSuccess}
      />

      <PairingKeyDialog
        key={pairingKey?.code || "none"}
        open={!!pairingKey}
        kind="session"
        pairingKey={pairingKey}
        onClose={handlePairingKeyClose}
      />
    </div>
  );
};

export default SessionsPage;
