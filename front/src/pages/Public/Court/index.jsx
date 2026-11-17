import { CircleAlert, Loader2, RotateCcw, Timer, VideoOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCourtPageHooks } from "./hooks";
import PublicLayout from "../../../components/layout/PublicLayout";
import ResultState from "../../../components/ResultState";
import Spinner from "../../../components/Spinner";
import { getImageUrl } from "../../../utils/upload";

const PRIVACY_NOTE =
  "This court is recorded. Only moments players choose to save are kept.";

const cardStyle = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-line)",
  borderRadius: "var(--radius-card)",
};

/**
 * `/court/:qrToken` — what a player sees after scanning the court's QR sign:
 * the venue and court, and one big button that saves the last 60 seconds.
 */
const CourtPage = () => {
  const {
    court,
    venueName,
    courtName,
    clipSeconds,
    cameraReady,
    isLoading,
    isFetching,
    notFound,
    loadError,
    refetch,
    handleSave,
    isSaving,
    saveError,
  } = useCourtPageHooks();

  if (isLoading) {
    return (
      <PublicLayout>
        <Spinner className="py-24" tip="Loading the court…" />
      </PublicLayout>
    );
  }

  if (notFound) {
    return (
      <PublicLayout footer={PRIVACY_NOTE}>
        <ResultState
          status="404"
          title="This court code isn't valid"
          description="The QR code may be out of date, or this court isn't in use right now. Ask the front desk for help."
        />
      </PublicLayout>
    );
  }

  if (loadError || !court) {
    return (
      <PublicLayout>
        <ResultState
          status="error"
          title="Couldn't load this court"
          description="Check your connection and try again."
          action={
            <Button onClick={() => refetch()} disabled={isFetching}>
              <RotateCcw />
              Try again
            </Button>
          }
        />
      </PublicLayout>
    );
  }

  const logo = getImageUrl(court.venueLogoUrl);

  return (
    <PublicLayout footer={PRIVACY_NOTE}>
      <div className="p-6 text-center" style={cardStyle}>
        {/* Venue */}
        <div className="flex flex-col items-center gap-2.5">
          {logo && (
            <img
              src={logo}
              alt=""
              className="object-contain"
              style={{ maxHeight: 64, maxWidth: 200 }}
            />
          )}
          <p
            className="m-0"
            style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-secondary)" }}
          >
            {venueName}
          </p>
        </div>

        {/* Court */}
        <h1
          className="m-0 mt-1 font-semibold leading-tight"
          style={{ fontSize: 32, letterSpacing: "-0.6px", color: "var(--color-text-dark)" }}
        >
          {courtName}
        </h1>

        {/* The one action */}
        <Button
          size="lg"
          className="mt-7 w-full h-16 text-base font-semibold rounded-(--radius-card)"
          disabled={!cameraReady || isSaving}
          onClick={handleSave}
        >
          {isSaving ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <Timer className="size-5" />
          )}
          {isSaving ? "Saving…" : `Save the last ${clipSeconds} seconds`}
        </Button>

        {cameraReady ? (
          <p
            className="m-0 mt-3"
            style={{ fontSize: 13, color: "var(--color-text-secondary)" }}
          >
            Tap right after a great rally — the camera has been rolling.
          </p>
        ) : (
          <div
            role="status"
            className="flex items-start gap-2.5 mt-4 px-3.5 py-3 text-left"
            style={{
              border: "1px solid var(--color-line)",
              borderRadius: 10,
              background: "var(--color-surface-sunken)",
              fontSize: 13.5,
              color: "var(--color-text-dark)",
            }}
          >
            <VideoOff
              className="w-4 h-4 mt-0.5 shrink-0"
              style={{ color: "var(--color-warning)" }}
            />
            <span>
              <strong className="font-semibold">The camera is offline.</strong>{" "}
              Nothing can be saved on this court right now — please tell the
              front desk. This page checks again on its own.
            </span>
          </div>
        )}

        {saveError && (
          <div
            role="alert"
            className="flex items-start gap-2.5 mt-4 px-3.5 py-3 text-left"
            style={{
              border: "1px solid var(--color-error)",
              borderRadius: 10,
              fontSize: 13.5,
              color: "var(--color-text-dark)",
            }}
          >
            <CircleAlert
              className="w-4 h-4 mt-0.5 shrink-0"
              style={{ color: "var(--color-error)" }}
            />
            <span>{saveError}</span>
          </div>
        )}
      </div>
    </PublicLayout>
  );
};

export default CourtPage;
