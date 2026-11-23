import { CircleAlert, Plus } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import SetupSection from "../../CourtSetup/components/SetupSection";
import DataTable from "../../../../../components/DataTable";
import PaginationFooter from "../../../../../components/PaginationFooter";
import RefreshButton from "../../../../../components/RefreshButton";
import StatusToggle from "../../../../../components/StatusToggle";

const WHEN_OPTIONS = [
  { v: "upcoming", label: "Upcoming" },
  { v: "past", label: "Past" },
];

/**
 * PLAN-003: closures (blackouts) — times a court, or the whole venue, can't be
 * booked or played on.
 */
const ClosuresSection = ({
  closures,
  columns,
  pagination,
  when,
  loading,
  fetching,
  error,
  canWrite,
  onWhenChange,
  onTableChange,
  onRefresh,
  onAdd,
}) => {
  const isEmpty = !loading && closures.length === 0;

  return (
    <SetupSection
      id="closures"
      title="Closures"
      description="Close a court, or the whole venue, for maintenance, an event or a tournament. Nobody can book or play on it then."
      aside={
        canWrite && (
          <Button type="button" size="sm" onClick={onAdd}>
            <Plus />
            Add closure
          </Button>
        )
      }
    >
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div className="w-56">
          <StatusToggle value={when} onChange={onWhenChange} options={WHEN_OPTIONS} />
        </div>
        <RefreshButton onRefresh={onRefresh} isFetching={fetching} />
      </div>

      {error ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Error loading closures</AlertTitle>
          <AlertDescription>
            {error.message || "Failed to load closures. Please try again."}
          </AlertDescription>
        </Alert>
      ) : isEmpty ? (
        <p
          className="m-0 py-8 text-center"
          style={{ fontSize: 13.5, color: "var(--color-text-muted)" }}
        >
          {when === "past" ? "No past closures" : "No closures coming up"}
        </p>
      ) : (
        <div
          className="overflow-hidden"
          style={{ border: "1px solid var(--color-line)", borderRadius: 10 }}
        >
          <DataTable
            dataSource={closures}
            columns={columns}
            rowKey="closureId"
            loading={loading}
            scroll={{ x: 640 }}
          />
          <PaginationFooter pagination={pagination} onChange={onTableChange} noun="closure" />
        </div>
      )}
    </SetupSection>
  );
};

export default ClosuresSection;
