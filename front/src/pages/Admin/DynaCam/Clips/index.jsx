import { useState } from "react";
import { CircleAlert, CircleCheck, Film, Filter, Hourglass } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useClipHooks } from "./hooks";
import ClipPreviewSheet from "./components/ClipPreviewSheet";
import PageHeader from "../../../../components/PageHeader";
import PaginationFooter from "../../../../components/PaginationFooter";
import StatCard from "../../../../components/StatCard";
import RefreshButton from "../../../../components/RefreshButton";
import SearchableSelect from "../../../../components/SearchableSelect";
import DatePicker from "../../../../components/DatePicker";
import DataTable from "../../../../components/DataTable";
import FilterField from "../../../../components/FilterField";
import { CLIP_SOURCE_LABEL } from "../../../../utils/dynaCam";

const ALL = "all";
const STATUSES = ["Pending", "Processing", "Ready", "Failed", "Expired", "Deleted"];

const ClipsPage = () => {
  const {
    data,
    pagination,
    filters,
    isLoading,
    isFetching,
    error,
    refetch,
    venueOptions,
    courtOptions,
    columns,
    handleTableChange,
    handleFilterChange,
    handleClearFilters,
    previewClip,
    handlePreviewClose,
    canTakePayment,
    handleRecordPayment,
    isRecordingPayment,
    handleCopyShareLink,
  } = useClipHooks();

  const [isFilterVisible, setIsFilterVisible] = useState(false);

  const totalClips = pagination?.total || 0;
  const readyClips = data?.filter((c) => c.status === "Ready").length || 0;
  const savingClips =
    data?.filter((c) => ["Pending", "Processing"].includes(c.status)).length || 0;

  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const hasActiveFilters = activeFilterCount > 0;
  const isEmpty = !isLoading && (data?.length || 0) === 0;

  if (error) {
    return (
      <div className="p-8">
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Error loading clips</AlertTitle>
          <AlertDescription>
            {error.message || "Failed to load clips. Please try again."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-5">
      {/* 1. HEADER */}
      <PageHeader
        title="Clips"
        subtitle="Replays saved from the court cameras by players (QR scan or court button) and the parts of booked sessions. View only."
      />

      {/* 2. STAT CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
        <StatCard
          title={hasActiveFilters ? "Matching clips" : "Total clips"}
          value={totalClips}
          change={hasActiveFilters ? "with these filters" : "kept now"}
          icon={<Film className="w-4.25 h-4.25" strokeWidth={1.8} />}
        />
        <StatCard
          title="Ready to watch"
          value={readyClips}
          change="on this page"
          icon={<CircleCheck className="w-4.25 h-4.25" strokeWidth={1.8} />}
        />
        <StatCard
          title="Still saving"
          value={savingClips}
          change="on this page"
          icon={<Hourglass className="w-4.25 h-4.25" strokeWidth={1.8} />}
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
        {/* Toolbar — the clips API has no text search, so filters only */}
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
              variant={
                isFilterVisible || hasActiveFilters ? "default" : "outline"
              }
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
            <FilterField label="Saved by">
              <Select
                value={filters.source || ALL}
                onValueChange={(v) =>
                  handleFilterChange("source", v === ALL ? "" : v)
                }
              >
                <SelectTrigger className="h-10 w-44">
                  <SelectValue placeholder="All sources" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All sources</SelectItem>
                  {Object.entries(CLIP_SOURCE_LABEL).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            <FilterField label="Payment">
              <Select
                value={filters.paymentStatus || ALL}
                onValueChange={(v) =>
                  handleFilterChange("paymentStatus", v === ALL ? "" : v)
                }
              >
                <SelectTrigger className="h-10 w-40">
                  <SelectValue placeholder="Any payment" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Any payment</SelectItem>
                  <SelectItem value="Free">Free</SelectItem>
                  <SelectItem value="Unpaid">Unpaid</SelectItem>
                  <SelectItem value="Paid">Paid</SelectItem>
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
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
            <p style={{ fontSize: 13.5, color: "var(--color-text-muted)" }}>
              {hasActiveFilters
                ? "No clips match these filters"
                : "No clips yet — they appear here as soon as a player saves one"}
            </p>
          </div>
        ) : (
          <>
            <DataTable
              dataSource={data}
              columns={columns}
              rowKey="clipId"
              loading={isLoading}
              scroll={{ x: 1340 }}
            />
            <PaginationFooter
              pagination={pagination}
              onChange={handleTableChange}
              noun="clip"
            />
          </>
        )}
      </div>

      {/* 4. PREVIEW */}
      <ClipPreviewSheet
        open={!!previewClip}
        clip={previewClip}
        canTakePayment={canTakePayment}
        isRecordingPayment={isRecordingPayment}
        onRecordPayment={handleRecordPayment}
        onClose={handlePreviewClose}
        onCopyLink={handleCopyShareLink}
      />
    </div>
  );
};

export default ClipsPage;
