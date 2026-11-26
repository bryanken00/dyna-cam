import { Link } from "react-router";
import { CalendarPlus, History, Play } from "lucide-react";

import { Button } from "@/components/ui/button";

import { useCourtPageHooks } from "./hooks";
import PublicLayout from "../../../components/layout/PublicLayout";
import ResultState from "../../../components/ResultState";
import Spinner from "../../../components/Spinner";

const cardStyle = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-line)",
  borderRadius: "var(--radius-card)",
};

/**
 * `/court/:qrToken` — what an old court QR sign opens. CR-045: courts no longer
 * have a QR for the camera and there's no booking code; recording starts from
 * the player's booking page ("I'm at the court — start recording"), which is in
 * My games and in their confirmation email.
 */
const CourtPage = () => {
  const { isLoading, notFound, courtName, venueName, logo, bookingPath } = useCourtPageHooks();

  if (isLoading) {
    return (
      <PublicLayout>
        <Spinner className="py-24" tip="Loading…" />
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      <div className="p-6 space-y-5" style={cardStyle}>
        {!notFound && (
          <div className="flex flex-col items-center gap-1 text-center">
            {logo && <img src={logo} alt="" className="object-contain mb-2" style={{ maxHeight: 56, maxWidth: 180 }} />}
            <div style={{ fontSize: 20, fontWeight: 600, color: "var(--color-text-dark)" }}>{courtName}</div>
            <div style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}>{venueName}</div>
          </div>
        )}
        <ResultState
          status="404"
          icon={<Play className="w-6 h-6" strokeWidth={1.8} />}
          title="Start recording from your booking"
          description="Open your booking — from My games or the link in your confirmation email — and tap “I'm at the court — start recording”. The camera records your booked time."
          action={
            <div className="flex flex-col items-center gap-2">
              <Button asChild size="lg">
                <Link to="/me/games">
                  <History />
                  My games
                </Link>
              </Button>
              <Button asChild variant="ghost">
                <Link to={bookingPath}>
                  <CalendarPlus />
                  Book a court
                </Link>
              </Button>
            </div>
          }
        />
      </div>
    </PublicLayout>
  );
};

export default CourtPage;
