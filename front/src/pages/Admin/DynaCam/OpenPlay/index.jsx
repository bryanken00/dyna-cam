import { CalendarSync, CircleAlert, Plus } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { clockText, dayNames, levelRange, useOpenPlayHooks } from "./hooks";
import PlaySessionFormDrawer from "./components/PlaySessionFormDrawer";
import PlaySessionSheet from "./components/PlaySessionSheet";
import DataTable from "../../../../components/DataTable";
import FilterField from "../../../../components/FilterField";
import PageHeader from "../../../../components/PageHeader";
import PaginationFooter from "../../../../components/PaginationFooter";
import RefreshButton from "../../../../components/RefreshButton";
import SearchableSelect from "../../../../components/SearchableSelect";
import SectionLabel from "../../../../components/SectionLabel";
import { decodeHTML } from "../../../../utils/decode-html";
import { formatPeso } from "../../../../utils/dynaCam";

const ALL = "all";

const cardStyle = {
  border: "1px solid var(--color-line)",
  borderRadius: "var(--radius-card)",
};

/**
 * PLAN-009 phase C — DGSports → Open Play. A venue's drop-in sessions: players
 * join from the player app (a fee per player, paid online, or free); the
 * session's courts can't be booked meanwhile.
 */
const OpenPlayPage = () => {
  const {
    canWrite,
    filters,
    venueOptions,
    venues,
    sessions,
    columns,
    pagination,
    series,
    isLoading,
    isFetching,
    error,
    refetch,
    handleFilterChange,
    handleTableChange,
    formOpen,
    editing,
    handleNew,
    handleFormClose,
    detailId,
    handleCloseDetail,
    handleStopSeries,
  } = useOpenPlayHooks();

  if (error) {
    return (
      <div className="p-8">
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Error loading Open Play</AlertTitle>
          <AlertDescription>{error.message || "Failed to load the sessions. Please try again."}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const isEmpty = !isLoading && sessions.length === 0;

  return (
    <div className="p-8 space-y-5">
      <PageHeader
        title="Open Play"
        subtitle="Drop-in sessions players join from the app. A session's courts can't be booked while it runs."
        actions={
          canWrite && (
            <Button onClick={handleNew} disabled={venues.length === 0}>
              <Plus />
              New session
            </Button>
          )
        }
      />

      <div className="bg-surface overflow-hidden" style={cardStyle}>
        <div
          className="flex items-end justify-between gap-3 flex-wrap px-4.5 py-3.5"
          style={{ borderBottom: "1px solid var(--color-line)" }}
        >
          <div className="flex items-end gap-3 flex-wrap">
            <FilterField label="Show">
              <Select value={filters.when} onValueChange={(v) => handleFilterChange("when", v)}>
                <SelectTrigger className="h-10 w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="upcoming">Upcoming</SelectItem>
                  <SelectItem value="past">Past</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
            {venueOptions.length > 1 && (
              <FilterField label="Venue">
                <SearchableSelect
                  className="w-56"
                  value={filters.venueId || ALL}
                  onValueChange={(v) => handleFilterChange("venueId", v === ALL ? "" : v)}
                  options={[{ value: ALL, label: "All venues" }, ...venueOptions]}
                />
              </FilterField>
            )}
          </div>
          <RefreshButton onRefresh={refetch} isFetching={isFetching} />
        </div>

        {isEmpty ? (
          <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
            <p style={{ fontSize: 13.5, color: "var(--color-text-muted)" }}>
              {filters.when === "past" ? "No past sessions" : "No Open Play sessions coming up"}
            </p>
            {canWrite && filters.when !== "past" && venues.length > 0 && (
              <Button variant="outline" onClick={handleNew}>
                <Plus />
                New session
              </Button>
            )}
          </div>
        ) : (
          <>
            <DataTable dataSource={sessions} columns={columns} rowKey="playSessionId" loading={isLoading} scroll={{ x: 1100 }} />
            <PaginationFooter pagination={pagination} onChange={handleTableChange} noun="session" />
          </>
        )}
      </div>

      {series.length > 0 && (
        <div className="bg-surface p-5" style={cardStyle}>
          <SectionLabel>Weekly series</SectionLabel>
          <ul className="m-0 p-0 list-none space-y-2">
            {series.map((s) => (
              <li
                key={s.seriesId}
                className="flex items-center justify-between gap-3 flex-wrap p-3"
                style={{ border: "1px solid var(--color-line)", borderRadius: 10 }}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <CalendarSync className="w-4.5 h-4.5 shrink-0" style={{ color: "var(--color-text-muted)" }} />
                  <span className="min-w-0">
                    <span className="block truncate" style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-dark)" }}>
                      {decodeHTML(s.title)}
                    </span>
                    <span className="block truncate" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
                      {dayNames(s.daysOfWeek)} · {clockText(s.startTime)} – {clockText(s.endTime)} ·{" "}
                      {decodeHTML(s.venueName)} · {decodeHTML(s.courtNames || "")} · {levelRange(s.minLevel, s.maxLevel)} ·{" "}
                      {s.pricePerHead > 0 ? formatPeso(s.pricePerHead) : "Free"}
                      {s.endsOn ? ` · until ${s.endsOn}` : ""} · {s.upcomingSessions} coming up
                    </span>
                  </span>
                </span>
                {canWrite && (
                  <Button variant="outline" size="sm" onClick={() => handleStopSeries(s)}>
                    Stop
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <PlaySessionFormDrawer
        open={formOpen}
        onClose={handleFormClose}
        onSuccess={handleFormClose}
        entity={editing}
      />
      <PlaySessionSheet open={!!detailId} playSessionId={detailId} onClose={handleCloseDetail} />
    </div>
  );
};

export default OpenPlayPage;
