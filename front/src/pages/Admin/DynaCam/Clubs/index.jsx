import { CircleAlert, Plus } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import { useClubsHooks } from "./hooks";
import ClubFormDrawer from "./components/ClubFormDrawer";
import ClubMembersSheet from "./components/ClubMembersSheet";
import DataTable from "../../../../components/DataTable";
import PageHeader from "../../../../components/PageHeader";
import RefreshButton from "../../../../components/RefreshButton";

/** PLAN-009 phase F — DGSports → Clubs: a venue's clubs players join from the player app. */
const ClubsPage = () => {
  const { canWrite, clubs, columns, isLoading, isFetching, error, refetch, formOpen, editing, handleNew, handleFormClose, membersOf, handleMembersClose } = useClubsHooks();

  if (error) {
    return (
      <div className="p-8">
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Error loading clubs</AlertTitle>
          <AlertDescription>{error.message || "Please try again."}</AlertDescription>
        </Alert>
      </div>
    );
  }
  return (
    <div className="p-8 space-y-5">
      <PageHeader
        title="Clubs"
        subtitle="Groups of regulars. Players join from the app; a session can be for one club's members only."
        actions={
          canWrite && (
            <Button onClick={handleNew}>
              <Plus />
              New club
            </Button>
          )
        }
      />
      <div className="bg-surface overflow-hidden" style={{ border: "1px solid var(--color-line)", borderRadius: "var(--radius-card)" }}>
        <div className="flex items-center justify-end px-4.5 py-3.5" style={{ borderBottom: "1px solid var(--color-line)" }}>
          <RefreshButton onRefresh={refetch} isFetching={isFetching} />
        </div>
        {!isLoading && clubs.length === 0 ? (
          <p className="m-0 py-20 text-center" style={{ fontSize: 13.5, color: "var(--color-text-muted)" }}>
            No clubs yet
          </p>
        ) : (
          <DataTable dataSource={clubs} columns={columns} rowKey="clubId" loading={isLoading} scroll={{ x: 800 }} />
        )}
      </div>
      <ClubFormDrawer open={formOpen} onClose={handleFormClose} onSuccess={handleFormClose} entity={editing} />
      <ClubMembersSheet open={!!membersOf} clubId={membersOf} onClose={handleMembersClose} />
    </div>
  );
};

export default ClubsPage;
