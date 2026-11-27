import { Link } from "react-router";
import {
  CalendarDays,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  History,
  PlayCircle,
  RotateCcw,
} from "lucide-react";
import dayjs from "dayjs";

import { Button } from "@/components/ui/button";

import { useMyGamesHooks } from "./hooks";
import VenueShortcuts from "./components/VenueShortcuts";
import PlaySpots from "./components/PlaySpots";
import PlayHistory from "./components/PlayHistory";
import MyTournaments from "./components/MyTournaments";
import PublicLayout from "../../../components/layout/PublicLayout";
import ResultState from "../../../components/ResultState";
import SectionLabel from "../../../components/SectionLabel";
import Spinner from "../../../components/Spinner";
import StatusDot from "../../../components/StatusDot";
import GoogleSignInButton from "../../../components/player/GoogleSignInButton";
import { decodeHTML } from "../../../utils/decode-html";
import {
  BOOKING_STATUS_TONE,
  PLAYER_BOOKING_STATUS_LABEL,
  PLAYER_GAME_STATUS_LABEL,
  SESSION_STATUS_TONE,
  formatPeso,
} from "../../../utils/dynaCam";

const cardStyle = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-line)",
  borderRadius: "var(--radius-card)",
};

const when = (startAt, endAt) => {
  const start = dayjs(startAt);
  return `${start.format("ddd, MMM D, YYYY")} · ${start.format("h:mm A")} – ${dayjs(endAt).format("h:mm A")}`;
};

/** One booking and its games. */
const BookingCard = ({ booking }) => (
  <div className="p-4 space-y-3" style={cardStyle}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-dark)" }}>
          {decodeHTML(booking.courtName)} · {decodeHTML(booking.venueName)}
        </div>
        <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
          {when(booking.startAt, booking.endAt)}
        </div>
      </div>
      <StatusDot tone={BOOKING_STATUS_TONE[booking.status]}>
        {PLAYER_BOOKING_STATUS_LABEL[booking.status] || booking.status}
      </StatusDot>
    </div>

    {booking.games.length > 0 && (
      <ul className="m-0 p-0 list-none space-y-2">
        {booking.games.map((game) => (
          <li
            key={game.gameUrl}
            className="p-3 flex flex-wrap items-center justify-between gap-2"
            style={{
              background: "var(--color-surface-sunken)",
              border: "1px solid var(--color-line)",
              borderRadius: 12,
            }}
          >
            <div className="min-w-0">
              <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--color-text-dark)" }}>
                Game · {dayjs(game.startAt).format("h:mm A")} – {dayjs(game.endAt).format("h:mm A")}
              </div>
              <StatusDot tone={SESSION_STATUS_TONE[game.status]}>
                {PLAYER_GAME_STATUS_LABEL[game.status] || game.status}
              </StatusDot>
            </div>
            <div className="flex flex-wrap gap-2">
              {game.driveUrl ? (
                <Button asChild size="sm">
                  <a href={game.driveUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink />
                    Open in Google Drive
                  </a>
                </Button>
              ) : (
                <Button asChild size="sm" variant="outline">
                  <a href={game.gameUrl}>
                    <PlayCircle />
                    Game page
                  </a>
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    )}

    <div className="flex items-center justify-between gap-3">
      <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
        {booking.price > 0 ? formatPeso(booking.price) : "Free"}
      </span>
      <Button asChild size="sm" variant="ghost">
        <a href={booking.bookingUrl}>Booking details</a>
      </Button>
    </div>
  </div>
);

/**
 * `/me/games` (PLAN-006) — the signed-in player's game log: bookings still to
 * play, then everything before (a page at a time), each with its games and
 * their Google Drive folders. Signed out: a sign-in prompt.
 */
const MyGamesPage = () => {
  const {
    signedIn,
    player,
    upcoming,
    past,
    recent,
    following,
    playSpots,
    playHistory,
    tournamentTeams,
    page,
    pages,
    totalPast,
    isLoading,
    isFetching,
    loadError,
    refetch,
    handleOlder,
    handleNewer,
  } = useMyGamesHooks();

  if (!signedIn) {
    return (
      <PublicLayout>
        <div className="p-6" style={cardStyle}>
          <ResultState
            status="404"
            icon={<History className="w-6 h-6" strokeWidth={1.8} />}
            title="Your games"
            description="Sign in with Google to see your bookings and the videos of every game you've played."
            action={<GoogleSignInButton returnPath="/me/games" />}
          />
        </div>
      </PublicLayout>
    );
  }

  if (isLoading) {
    return (
      <PublicLayout>
        <Spinner className="py-24" tip="Loading your games…" />
      </PublicLayout>
    );
  }

  if (loadError) {
    return (
      <PublicLayout>
        <ResultState
          status="error"
          title="Couldn't load your games"
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

  const empty = upcoming.length === 0 && totalPast === 0;

  return (
    <PublicLayout>
      <div className="space-y-6">
        <div>
          <h1
            className="m-0 font-semibold leading-tight"
            style={{ fontSize: 26, letterSpacing: "-0.5px", color: "var(--color-text-dark)" }}
          >
            My games
          </h1>
          {player && (
            <p className="m-0" style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}>
              {player.email}
            </p>
          )}
        </div>

        <PlaySpots spots={playSpots} />
        <MyTournaments teams={tournamentTeams} />
        <VenueShortcuts recent={recent} following={following} />

        {empty ? (
          <div className="p-6" style={cardStyle}>
            <ResultState
              status="404"
              icon={<CalendarDays className="w-6 h-6" strokeWidth={1.8} />}
              title="No games yet"
              description="Book a court and your booking shows here, then the videos of each game you play."
              action={
                <Button asChild>
                  <Link to="/book">
                    <CalendarPlus />
                    Book a court
                  </Link>
                </Button>
              }
            />
          </div>
        ) : (
          <>
            {upcoming.length > 0 && (
              <section>
                <SectionLabel>Coming up</SectionLabel>
                <div className="space-y-3">
                  {upcoming.map((b) => (
                    <BookingCard key={b.bookingCode} booking={b} />
                  ))}
                </div>
              </section>
            )}

            {past.length > 0 && (
              <section>
                <SectionLabel>Played and past</SectionLabel>
                <div className="space-y-3">
                  {past.map((b) => (
                    <BookingCard key={b.bookingCode} booking={b} />
                  ))}
                </div>
              </section>
            )}

            {pages > 1 && (
              <div className="flex items-center justify-between gap-3">
                <Button variant="outline" size="sm" onClick={handleNewer} disabled={page <= 1 || isFetching}>
                  <ChevronLeft />
                  Newer
                </Button>
                <span style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
                  Page {page} of {pages}
                </span>
                <Button variant="outline" size="sm" onClick={handleOlder} disabled={page >= pages || isFetching}>
                  Older
                  <ChevronRight />
                </Button>
              </div>
            )}
          </>
        )}
        <PlayHistory sessions={playHistory} />
      </div>
    </PublicLayout>
  );
};

export default MyGamesPage;
