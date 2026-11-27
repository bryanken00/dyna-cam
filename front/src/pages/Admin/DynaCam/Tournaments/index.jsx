import { CircleAlert, Plus } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useTournamentsHooks } from "./hooks";
import TournamentFormDrawer from "./components/TournamentFormDrawer";
import DataTable from "../../../../components/DataTable";
import FilterField from "../../../../components/FilterField";
import PageHeader from "../../../../components/PageHeader";
import PaginationFooter from "../../../../components/PaginationFooter";
import RefreshButton from "../../../../components/RefreshButton";

const ALL = "all";
const STATUSES = ["Draft", "Open", "Closed", "Live", "Finished", "Cancelled"];

/**
 * PLAN-009 phase E — DGSports → Tournaments. Add an event, its divisions, open
 * registration; players register teams from the player app.
 */
const TournamentsPage = () => {
  const {
    canWrite,
    status,
    handleStatus,
    tournaments,
    columns,
    pagination,
    handleTableChange,
    isLoading,
    isFetching,
    error,
    refetch,
    formOpen,
    handleNew,
    handleFormClose,
    handleCreated,
  } = useTournamentsHooks();

  if (error) {
    return (
      <div className="p-8">
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Error loading tournaments</AlertTitle>
          <AlertDescription>{error.message || "Please try again."}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-5">
      <PageHeader
        title="Tournaments"
        subtitle="Events with divisions players register teams for. Their courts are held for the event."
        actions={
          canWrite && (
            <Button onClick={handleNew}>
              <Plus />
              New tournament
            </Button>
          )
        }
      />
      <div className="bg-surface overflow-hidden" style={{ border: "1px solid var(--color-line)", borderRadius: "var(--radius-card)" }}>
        <div className="flex items-end justify-between gap-3 flex-wrap px-4.5 py-3.5" style={{ borderBottom: "1px solid var(--color-line)" }}>
          <FilterField label="Status">
            <Select value={status || ALL} onValueChange={(v) => handleStatus(v === ALL ? "" : v)}>
              <SelectTrigger className="h-10 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>
          <RefreshButton onRefresh={refetch} isFetching={isFetching} />
        </div>
        {!isLoading && tournaments.length === 0 ? (
          <p className="m-0 py-20 text-center" style={{ fontSize: 13.5, color: "var(--color-text-muted)" }}>
            No tournaments yet
          </p>
        ) : (
          <>
            <DataTable dataSource={tournaments} columns={columns} rowKey="tournamentId" loading={isLoading} scroll={{ x: 950 }} />
            <PaginationFooter pagination={pagination} onChange={handleTableChange} noun="tournament" />
          </>
        )}
      </div>
      <TournamentFormDrawer open={formOpen} onClose={handleFormClose} onSuccess={handleCreated} />
    </div>
  );
};

export default TournamentsPage;
