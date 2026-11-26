import { useState } from "react";
import {
  CalendarRange,
  CircleAlert,
  Filter,
  Receipt,
  Wallet,
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
import { usePaymentHooks } from "./hooks";
import PageHeader from "../../../../components/PageHeader";
import PaginationFooter from "../../../../components/PaginationFooter";
import StatCard from "../../../../components/StatCard";
import RefreshButton from "../../../../components/RefreshButton";
import SearchableSelect from "../../../../components/SearchableSelect";
import DatePicker from "../../../../components/DatePicker";
import DataTable from "../../../../components/DataTable";
import FilterField from "../../../../components/FilterField";
import { formatPeso } from "../../../../utils/dynaCam";

const ALL = "all";

const PaymentsPage = () => {
  const {
    data,
    totals,
    pagination,
    filters,
    isLoading,
    isFetching,
    error,
    refetch,
    canListVenues,
    venueOptions,
    columns,
    handleTableChange,
    handleFilterChange,
    handleClearFilters,
  } = usePaymentHooks();

  const [isFilterVisible, setIsFilterVisible] = useState(false);

  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const hasActiveFilters = activeFilterCount > 0;
  const isEmpty = !isLoading && (data?.length || 0) === 0;
  // Totals follow the venue filter only (not status or dates)
  const totalsScope = filters.venueId ? "this venue" : "all venues";

  if (error) {
    return (
      <div className="p-8">
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Error loading payments</AlertTitle>
          <AlertDescription>
            {error.message || "Failed to load payments. Please try again."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-5">
      {/* 1. HEADER */}
      <PageHeader
        title="Payments"
        subtitle="Court bookings paid online, and cash taken before payments went online-only (CR-046)."
      />

      {/* 2. STAT CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
        <StatCard
          title="Today"
          value={formatPeso(totals.today)}
          change={totalsScope}
          icon={<Wallet className="w-4.25 h-4.25" strokeWidth={1.8} />}
        />
        <StatCard
          title="Payments today"
          value={totals.countToday}
          change={totalsScope}
          icon={<Receipt className="w-4.25 h-4.25" strokeWidth={1.8} />}
        />
        <StatCard
          title="This month"
          value={formatPeso(totals.thisMonth)}
          change={totalsScope}
          icon={<CalendarRange className="w-4.25 h-4.25" strokeWidth={1.8} />}
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
              {activeFilterCount > 0 && ` · ${activeFilterCount}`}
            </Button>
          </div>
        </div>

        {/* Filter row */}
        {isFilterVisible && (
          <div
            className="flex items-end gap-3 flex-wrap px-4.5 py-3.5"
            style={{ borderBottom: "1px solid var(--color-line)" }}
          >
            {canListVenues && (
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
            )}
            <FilterField label="Status">
              <Select
                value={filters.status || ALL}
                onValueChange={(v) =>
                  handleFilterChange("status", v === ALL ? "" : v)
                }
              >
                <SelectTrigger className="h-10 w-40">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All statuses</SelectItem>
                  <SelectItem value="Paid">Paid</SelectItem>
                  <SelectItem value="Refunded">Refunded</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="From">
              <DatePicker
                className="w-40"
                value={filters.dateFrom}
                max={filters.dateTo || undefined}
                placeholder="Any date"
                onChange={(e) => handleFilterChange("dateFrom", e.target.value)}
              />
            </FilterField>
            <FilterField label="To">
              <DatePicker
                className="w-40"
                value={filters.dateTo}
                min={filters.dateFrom || undefined}
                placeholder="Any date"
                onChange={(e) => handleFilterChange("dateTo", e.target.value)}
              />
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
                ? "No payments match these filters"
                : "No payments yet — they appear here when players pay for their bookings online"}
            </p>
          </div>
        ) : (
          <>
            <DataTable
              dataSource={data}
              columns={columns}
              rowKey="paymentId"
              loading={isLoading}
              scroll={{ x: 1250 }}
            />
            <PaginationFooter
              pagination={pagination}
              onChange={handleTableChange}
              noun="payment"
            />
          </>
        )}
      </div>

    </div>
  );
};

export default PaymentsPage;
