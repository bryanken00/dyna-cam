import { useState } from "react";
import {
  Banknote,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Filter,
  Plus,
  UserX,
  Wallet,
} from "lucide-react";
import dayjs from "dayjs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBookingHooks } from "./hooks";
import DayGrid from "./components/DayGrid";
import BookingFormDrawer from "./components/BookingFormDrawer";
import BookingDetailSheet from "./components/BookingDetailSheet";
import PageHeader from "../../../../components/PageHeader";
import PaginationFooter from "../../../../components/PaginationFooter";
import StatCard from "../../../../components/StatCard";
import RefreshButton from "../../../../components/RefreshButton";
import SearchableSelect from "../../../../components/SearchableSelect";
import SearchInput from "../../../../components/SearchInput";
import DatePicker from "../../../../components/DatePicker";
import DataTable from "../../../../components/DataTable";
import FilterField from "../../../../components/FilterField";
import Spinner from "../../../../components/Spinner";
import StatusToggle from "../../../../components/StatusToggle";
import { BOOKING_STATUS_LABEL, formatHour, formatPeso, manilaNow } from "../../../../utils/dynaCam";

const ALL = "all";
const VIEW_OPTIONS = [{ v: "Day" }, { v: "List" }];
const STATUS_FILTERS = ["Pending", "Confirmed", "CheckedIn", "Completed", "NoShow", "Cancelled", "Expired"];

/** Dyna Cam → Bookings (PLAN-003): the desk's court bookings. */
const BookingsPage = () => {
  const {
    canWrite,
    view,
    setView,
    venueId,
    venueOptions,
    allCourts,
    optionsLoading,
    hasVenues,
    date,
    day,
    dayLoading,
    dayFetching,
    dayError,
    refetchDay,
    handleVenueChange,
    handleDateChange,
    handleShiftDate,
    handleToday,
    handleCellClick,
    bookings,
    stats,
    pagination,
    filters,
    activeFilterCount,
    listLoading,
    listFetching,
    listError,
    refetchList,
    columns,
    handleFilterChange,
    handleClearFilters,
    handleTableChange,
    formOpen,
    formEntity,
    handleNewBooking,
    handleFormClose,
    handleFormSuccess,
    detailBookingId,
    handleOpenDetail,
    handleCloseDetail,
  } = useBookingHooks();

  const [isFilterVisible, setIsFilterVisible] = useState(false);
  const isToday = date === manilaNow().date;
  const error = view === "Day" ? dayError : listError;

  if (optionsLoading) {
    return (
      <div className="p-8">
        <Spinner className="py-24" tip="Loading bookings…" />
      </div>
    );
  }

  return (
    <div className="p-8 space-y-5">
      {/* 1. HEADER */}
      <PageHeader
        title="Bookings"
        subtitle="Court bookings — at the desk and from the venue's online booking link."
        actions={
          canWrite &&
          hasVenues && (
            <Button onClick={() => handleNewBooking()}>
              <Plus />
              New booking
            </Button>
          )
        }
      />

      {!hasVenues ? (
        <div
          className="bg-surface flex flex-col items-center justify-center gap-2 py-20 text-center"
          style={{ border: "1px solid var(--color-line)", borderRadius: "var(--radius-card)" }}
        >
          <p className="m-0" style={{ fontSize: 13.5, color: "var(--color-text-muted)" }}>
            No venues yet — add one in Venues, then set its hours and prices.
          </p>
        </div>
      ) : (
        <>
          {/* 2. STAT CARDS — follow the venue */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            <StatCard
              title="Booked today"
              value={stats.today}
              change="this venue"
              icon={<CalendarCheck className="w-4.25 h-4.25" strokeWidth={1.8} />}
            />
            <StatCard
              title="Waiting for payment"
              value={stats.unpaid}
              change="unpaid holds"
              icon={<Banknote className="w-4.25 h-4.25" strokeWidth={1.8} />}
            />
            <StatCard
              title="No-shows"
              value={stats.noShowsThisWeek}
              change="last 7 days"
              icon={<UserX className="w-4.25 h-4.25" strokeWidth={1.8} />}
            />
            <StatCard
              title="Booking payments today"
              value={formatPeso(stats.revenueToday)}
              change="this venue"
              icon={<Wallet className="w-4.25 h-4.25" strokeWidth={1.8} />}
            />
          </div>

          {/* 3. CARD */}
          <div
            className="bg-surface overflow-hidden"
            style={{ border: "1px solid var(--color-line)", borderRadius: "var(--radius-card)" }}
          >
            {/* Toolbar */}
            <div
              className="flex items-center justify-between gap-3 flex-wrap px-4.5 py-3.5"
              style={{ borderBottom: "1px solid var(--color-line)" }}
            >
              <div className="flex items-center gap-3 flex-wrap">
                <SearchableSelect
                  className="w-56"
                  value={venueId}
                  onValueChange={handleVenueChange}
                  options={venueOptions}
                />
                <div className="w-44">
                  <StatusToggle value={view} onChange={setView} options={VIEW_OPTIONS} />
                </div>
                {view === "Day" ? (
                  <div className="flex items-center gap-1.5">
                    <Button variant="outline" size="icon" aria-label="Previous day" onClick={() => handleShiftDate(-1)}>
                      <ChevronLeft />
                    </Button>
                    <DatePicker
                      className="w-40"
                      value={date}
                      allowClear={false}
                      onChange={(e) => handleDateChange(e.target.value)}
                    />
                    <Button variant="outline" size="icon" aria-label="Next day" onClick={() => handleShiftDate(1)}>
                      <ChevronRight />
                    </Button>
                    {!isToday && (
                      <Button variant="outline" size="sm" onClick={handleToday}>
                        Today
                      </Button>
                    )}
                  </div>
                ) : (
                  <SearchInput
                    value={filters.search}
                    onChange={(v) => handleFilterChange("search", v)}
                    placeholder="Name, phone or code…"
                  />
                )}
              </div>
              <div className="flex items-center gap-2">
                <RefreshButton
                  onRefresh={view === "Day" ? refetchDay : refetchList}
                  isFetching={view === "Day" ? dayFetching : listFetching}
                />
                {view === "List" && (
                  <Button
                    variant={isFilterVisible || activeFilterCount > 0 ? "default" : "outline"}
                    size="sm"
                    onClick={() => setIsFilterVisible(!isFilterVisible)}
                  >
                    <Filter />
                    Filters
                    {activeFilterCount > 0 && ` · ${activeFilterCount}`}
                  </Button>
                )}
              </div>
            </div>

            {/* List filters */}
            {view === "List" && isFilterVisible && (
              <div
                className="flex items-end gap-3 flex-wrap px-4.5 py-3.5"
                style={{ borderBottom: "1px solid var(--color-line)" }}
              >
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
                      {STATUS_FILTERS.map((s) => (
                        <SelectItem key={s} value={s}>
                          {BOOKING_STATUS_LABEL[s]}
                        </SelectItem>
                      ))}
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
                {activeFilterCount > 0 && (
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

            {error ? (
              <div className="p-4.5">
                <Alert variant="destructive">
                  <CircleAlert />
                  <AlertTitle>Error loading bookings</AlertTitle>
                  <AlertDescription>{error.message || "Please try again."}</AlertDescription>
                </Alert>
              </div>
            ) : view === "Day" ? (
              dayLoading || !day ? (
                <Spinner className="py-16" tip="Loading the day…" />
              ) : (
                <>
                  <div
                    className="px-4.5 py-2.5"
                    style={{
                      fontSize: 12.5,
                      color: "var(--color-text-muted)",
                      borderBottom: "1px solid var(--color-line)",
                    }}
                  >
                    {dayjs(date).format("dddd, MMMM D")} ·{" "}
                    {day.hours
                      ? `open ${formatHour(day.hours.opensAt)} – ${formatHour(day.hours.closesAt)}`
                      : "closed (no opening hours this day)"}
                    {canWrite && " · click a free hour to book it"}
                  </div>
                  {day.courts.length === 0 ? (
                    <p
                      className="m-0 py-16 text-center"
                      style={{ fontSize: 13.5, color: "var(--color-text-muted)" }}
                    >
                      No courts at this venue yet
                    </p>
                  ) : (
                    <DayGrid
                      day={day}
                      canWrite={canWrite}
                      onCellClick={handleCellClick}
                      onBookingClick={handleOpenDetail}
                    />
                  )}
                </>
              )
            ) : !listLoading && bookings.length === 0 ? (
              <p
                className="m-0 py-20 text-center"
                style={{ fontSize: 13.5, color: "var(--color-text-muted)" }}
              >
                {activeFilterCount > 0 ? "No bookings match these filters" : "No bookings yet"}
              </p>
            ) : (
              <>
                <DataTable
                  dataSource={bookings}
                  columns={columns}
                  rowKey="bookingId"
                  loading={listLoading}
                  scroll={{ x: 1000 }}
                />
                <PaginationFooter pagination={pagination} onChange={handleTableChange} noun="booking" />
              </>
            )}
          </div>
        </>
      )}

      {/* 4. DRAWER + DETAIL */}
      {canWrite && (
        <BookingFormDrawer
          open={formOpen}
          entity={formEntity}
          onClose={handleFormClose}
          onSuccess={handleFormSuccess}
        />
      )}
      <BookingDetailSheet
        open={!!detailBookingId}
        bookingId={detailBookingId}
        courts={allCourts}
        onClose={handleCloseDetail}
      />
    </div>
  );
};

export default BookingsPage;
