import { Link } from "react-router";
import { ChevronLeft, CircleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useCourtSetupHooks } from "./hooks";
import ButtonSection from "./components/ButtonSection";
import CameraSection from "./components/CameraSection";
import GoogleDriveSection from "./components/GoogleDriveSection";
import QrSignSection from "./components/QrSignSection";
import StreamSection from "./components/StreamSection";
import PageHeader from "../../../../components/PageHeader";
import RefreshButton from "../../../../components/RefreshButton";
import ResultState from "../../../../components/ResultState";
import Spinner from "../../../../components/Spinner";
import StatusDot from "../../../../components/StatusDot";
import { VENUES_PATH, venuePath } from "../../../../utils/dynaCam";

/**
 * `/admin/setup/venues/:venueId/courts/:courtId` — set up one court: its
 * camera and optional camera 2 (guided, with the live check), QR sign,
 * button and live stream.
 * Each section saves on its own with the court's full PUT.
 */
const CourtSetupPage = () => {
  const {
    venueId,
    court,
    courtName,
    venueName,
    isLoading,
    isFetching,
    error,
    notFound,
    refetch,
    canWrite,
    justSaved,
    checking,
    handleCameraSaved,
  } = useCourtSetupHooks();

  const breadcrumb = (
    <div
      className="flex items-center gap-1 flex-wrap"
      style={{ fontSize: 13, color: "var(--color-text-secondary)" }}
    >
      <Link to={VENUES_PATH} className="hover:underline">
        Venues
      </Link>
      <span style={{ color: "var(--color-text-muted)" }}>/</span>
      <Link
        to={venuePath(venueId)}
        className="inline-flex items-center gap-1 hover:underline"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
        {venueName || "Venue"}
      </Link>
    </div>
  );

  if (isLoading) {
    return (
      <div className="p-8">
        <Spinner className="py-24" tip="Loading court…" />
      </div>
    );
  }

  if (notFound || (!error && !court)) {
    return (
      <div className="p-8 space-y-4">
        {breadcrumb}
        <ResultState
          status="404"
          title="Court not found"
          description="It may have been deleted. Pick it again from its venue."
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 space-y-4">
        {breadcrumb}
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Error loading the court</AlertTitle>
          <AlertDescription>
            {error.message || "Failed to load the court. Please try again."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-5 max-w-5xl">
      {breadcrumb}

      <PageHeader
        title={courtName}
        subtitle={`${venueName} · set up the cameras, QR sign, button, live stream and Google Drive`}
        actions={
          <div className="flex items-center gap-3">
            <StatusDot tone={court.status === "Active" ? "success" : "muted"}>
              {court.status}
            </StatusDot>
            <RefreshButton onRefresh={refetch} isFetching={isFetching} />
          </div>
        }
      />

      {/* `key` remounts a section's form when another court is opened */}
      <CameraSection
        key={`camera-${court.courtId}`}
        slot="camera"
        court={court}
        canWrite={canWrite}
        checking={!!checking.camera}
        justSaved={!!justSaved.camera}
        onSaved={handleCameraSaved}
      />
      <CameraSection
        key={`camera2-${court.courtId}`}
        slot="camera2"
        court={court}
        canWrite={canWrite}
        checking={!!checking.camera2}
        justSaved={!!justSaved.camera2}
        onSaved={handleCameraSaved}
      />
      <QrSignSection key={`qr-${court.courtId}`} court={court} canWrite={canWrite} />
      <ButtonSection key={`button-${court.courtId}`} court={court} canWrite={canWrite} />
      <StreamSection key={`stream-${court.courtId}`} court={court} canWrite={canWrite} />
      <GoogleDriveSection key={`drive-${court.courtId}`} court={court} canWrite={canWrite} />
    </div>
  );
};

export default CourtSetupPage;
