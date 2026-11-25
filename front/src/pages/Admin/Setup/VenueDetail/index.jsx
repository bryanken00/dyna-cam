import { Link } from "react-router";
import { ChevronLeft, CircleAlert, Pencil, Plus } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useVenueDetailHooks } from "./hooks";
import { useVenueBookingHooks } from "./bookingHooks";
import VenueInfoCard from "./components/VenueInfoCard";
import BookingLinkSection from "./components/BookingLinkSection";
import BookingRulesSection from "./components/BookingRulesSection";
import BookingSettingsFormDrawer from "./components/BookingSettingsFormDrawer";
import ClosuresSection from "./components/ClosuresSection";
import ClosureFormDrawer from "./components/ClosureFormDrawer";
import VenueFormDrawer from "../Venues/components/VenueFormDrawer";
import CourtFormDrawer from "../components/CourtFormDrawer";
import PageHeader from "../../../../components/PageHeader";
import PaginationFooter from "../../../../components/PaginationFooter";
import RefreshButton from "../../../../components/RefreshButton";
import SearchInput from "../../../../components/SearchInput";
import DataTable from "../../../../components/DataTable";
import ResultState from "../../../../components/ResultState";
import Spinner from "../../../../components/Spinner";
import { VENUES_PATH } from "../../../../utils/dynaCam";

/** `/admin/setup/venues/:venueId` — a venue's info and its courts. */
const VenueDetailPage = () => {
  const {
    venueId,
    venue,
    venueName,
    venueLoading,
    venueError,
    notFound,
    canReadVenue,
    canEditVenue,
    canReadCourts,
    canWriteCourts,
    courts,
    pagination,
    search,
    courtsLoading,
    courtsFetching,
    courtsError,
    refetchCourts,
    columns,
    handleTableChange,
    handleSearch,
    venueDrawerOpen,
    handleEditVenue,
    handleVenueDrawerClose,
    courtDrawerOpen,
    courtDrawerEntity,
    handleAddCourt,
    handleCourtDrawerClose,
    handleCourtDrawerSuccess,
  } = useVenueDetailHooks();
  const booking = useVenueBookingHooks(venueId, {
    isDeleted: venue?.status === "Deleted",
  });

  const backLink = (
    <Link
      to={VENUES_PATH}
      className="inline-flex items-center gap-1 hover:underline"
      style={{ fontSize: 13, color: "var(--color-text-secondary)" }}
    >
      <ChevronLeft className="w-4 h-4" />
      Venues
    </Link>
  );

  if (venueLoading) {
    return (
      <div className="p-8">
        <Spinner className="py-24" tip="Loading venue…" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="p-8 space-y-4">
        {backLink}
        <ResultState
          status="404"
          title="Venue not found"
          description="It may have been deleted. Pick it again from Venues."
        />
      </div>
    );
  }

  if (venueError) {
    return (
      <div className="p-8 space-y-4">
        {backLink}
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Error loading the venue</AlertTitle>
          <AlertDescription>
            {venueError.message || "Failed to load the venue. Please try again."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const isDeleted = venue?.status === "Deleted";
  const isCourtsEmpty = !courtsLoading && courts.length === 0;

  return (
    <div className="p-8 space-y-5">
      {backLink}

      {/* 1. HEADER */}
      <PageHeader
        title={venueName || "Venue"}
        subtitle="Its courts and cameras, and how players book them."
        actions={
          <>
            {canEditVenue && !isDeleted && (
              <Button variant="outline" onClick={handleEditVenue}>
                <Pencil />
                Edit venue
              </Button>
            )}
            {canWriteCourts && !isDeleted && (
              <Button onClick={handleAddCourt}>
                <Plus />
                Add court
              </Button>
            )}
          </>
        }
      />

      {/* 2. VENUE INFO (venues/list) */}
      {canReadVenue && venue && <VenueInfoCard venue={venue} />}

      {/* 3. COURTS (venues/courts) */}
      {canReadCourts && (
        <div
          className="bg-surface overflow-hidden"
          style={{
            border: "1px solid var(--color-line)",
            borderRadius: "var(--radius-card)",
          }}
        >
          <div
            className="flex items-center justify-between gap-3 flex-wrap px-4.5 py-3.5"
            style={{ borderBottom: "1px solid var(--color-line)" }}
          >
            <div className="flex items-center gap-3 flex-wrap">
              <span
                className="font-semibold"
                style={{ fontSize: 15, color: "var(--color-text-dark)" }}
              >
                Courts
              </span>
              <SearchInput
                value={search}
                onChange={handleSearch}
                placeholder="Filter courts…"
              />
            </div>
            <RefreshButton onRefresh={refetchCourts} isFetching={courtsFetching} />
          </div>

          {courtsError ? (
            <div className="p-4.5">
              <Alert variant="destructive">
                <CircleAlert />
                <AlertTitle>Error loading courts</AlertTitle>
                <AlertDescription>
                  {courtsError.message || "Failed to load courts. Please try again."}
                </AlertDescription>
              </Alert>
            </div>
          ) : isCourtsEmpty ? (
            <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
              <p style={{ fontSize: 13.5, color: "var(--color-text-muted)" }}>
                {search ? "No courts match that" : "No courts at this venue yet"}
              </p>
              {canWriteCourts && !search && !isDeleted && (
                <Button onClick={handleAddCourt}>
                  <Plus />
                  Add court
                </Button>
              )}
            </div>
          ) : (
            <>
              <DataTable
                dataSource={courts}
                columns={columns}
                rowKey="courtId"
                loading={courtsLoading}
                scroll={{ x: 860 }}
              />
              <PaginationFooter
                pagination={pagination}
                onChange={handleTableChange}
                noun="court"
              />
            </>
          )}
        </div>
      )}

      {/* 4. BOOKINGS (bookings) — PLAN-003 */}
      {booking.canReadBookings &&
        (booking.settingsError ? (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>Error loading the booking settings</AlertTitle>
            <AlertDescription>
              {booking.settingsError.message ||
                "Failed to load the booking settings. Please try again."}
            </AlertDescription>
          </Alert>
        ) : booking.settingsLoading || !booking.settings ? (
          <Spinner className="py-10" tip="Loading booking settings…" />
        ) : (
          <>
            <BookingLinkSection
              settings={booking.settings}
              canWrite={booking.canWriteBookings}
              isIssuing={booking.isIssuingLink}
              isTurningOff={booking.isTurningOffLink}
              onIssue={booking.handleIssueLink}
              onTurnOff={booking.handleTurnOffLink}
              onCopy={booking.handleCopyLink}
              onPrint={booking.handlePrintSign}
            />
            <BookingRulesSection
              settings={booking.settings}
              canWrite={booking.canWriteBookings}
              onEdit={booking.handleEditSettings}
              isConfirmingWeek={booking.isConfirmingWeek}
              onConfirmWeek={booking.handleConfirmWeek}
              isUnconfirmingWeek={booking.isUnconfirmingWeek}
              onUnconfirmWeek={booking.handleUnconfirmWeek}
            />
            <ClosuresSection
              closures={booking.closures}
              columns={booking.closureColumns}
              pagination={booking.closuresPagination}
              when={booking.closuresWhen}
              loading={booking.closuresLoading}
              fetching={booking.closuresFetching}
              error={booking.closuresError}
              canWrite={booking.canWriteBookings}
              onWhenChange={booking.handleClosuresWhenChange}
              onTableChange={booking.handleClosuresTableChange}
              onRefresh={booking.refetchClosures}
              onAdd={booking.handleAddClosure}
            />
          </>
        ))}

      {/* 5. DRAWERS */}
      {canEditVenue && (
        <VenueFormDrawer
          open={venueDrawerOpen}
          entity={venue}
          onClose={handleVenueDrawerClose}
          onSuccess={handleVenueDrawerClose}
        />
      )}
      {booking.canWriteBookings && (
        <BookingSettingsFormDrawer
          open={booking.settingsDrawerOpen}
          entity={booking.settingsDrawerEntity}
          onClose={booking.handleSettingsDrawerClose}
          onSuccess={booking.handleSettingsDrawerClose}
        />
      )}
      {booking.canWriteBookings && (
        <ClosureFormDrawer
          open={booking.closureDrawerOpen}
          entity={booking.closureDrawerEntity}
          onClose={booking.handleClosureDrawerClose}
          onSuccess={booking.handleClosureDrawerClose}
        />
      )}
      {canWriteCourts && (
        <CourtFormDrawer
          open={courtDrawerOpen}
          entity={courtDrawerEntity}
          onClose={handleCourtDrawerClose}
          onSuccess={handleCourtDrawerSuccess}
        />
      )}
    </div>
  );
};

export default VenueDetailPage;
