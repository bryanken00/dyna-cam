import { Link, Navigate } from "react-router";
import {
  CalendarCheck,
  ChevronRight,
  Clock,
  CreditCard,
  Heart,
  LayoutGrid,
  Loader2,
  LocateFixed,
  LogIn,
  MapPin,
  Navigation,
  Play,
  RotateCcw,
  Sparkles,
  Store,
  Ticket,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";

import { useVenuesPageHooks } from "./hooks";
import PublicLayout from "../../../components/layout/PublicLayout";
import DiscoverTabs from "../../../components/layout/DiscoverTabs";
import ResultState from "../../../components/ResultState";
import SearchInput from "../../../components/SearchInput";
import Spinner from "../../../components/Spinner";
import PickChip from "../../../components/PickChip";
import GoogleSignInButton from "../../../components/player/GoogleSignInButton";

const cardStyle = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-line)",
  borderRadius: "var(--radius-card)",
};

const metaStyle = { fontSize: 13, color: "var(--color-text-secondary)" };
const metaIcon = "h-3.5 w-3.5 shrink-0";

/** "Already booked?" — CR-045: a player's bookings are in My games (no Find my booking). */
const FindBookingCard = () => (
  <Link
    to="/me/games"
    className="p-4 flex items-center gap-3"
    style={{ ...cardStyle, textDecoration: "none" }}
  >
    <span
      className="inline-flex items-center justify-center h-10 w-10 shrink-0"
      style={{ background: "var(--color-surface-sunken)", borderRadius: 12 }}
    >
      <Ticket className="h-5 w-5" style={{ color: "var(--color-text-secondary)" }} />
    </span>
    <span className="min-w-0 flex-1">
      <span className="block" style={{ fontSize: 14.5, fontWeight: 600, color: "var(--color-text-dark)" }}>
        Already booked?
      </span>
      <span className="block" style={metaStyle}>
        Your bookings are in My games — pay, start recording, move or cancel there.
      </span>
    </span>
    <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--color-text-muted)" }} />
  </Link>
);

/** CR-035: the three steps, beside the list on wide screens. */
const HOW_IT_WORKS = [
  { icon: LogIn, text: "Sign in with Google — your bookings and game videos stay with your account." },
  { icon: CalendarCheck, text: "Pick a venue, then a day, a court and a time." },
  { icon: CreditCard, text: "Pay online to reserve it — GCash, Maya or a card. No payment at the counter." },
  { icon: Play, text: "At the court, open your booking and tap “I'm at the court — start recording”." },
];

const HowItWorksCard = () => (
  <div className="p-5" style={cardStyle}>
    <h2 className="m-0 mb-3 font-semibold" style={{ fontSize: 14.5, color: "var(--color-text-dark)" }}>
      How booking works
    </h2>
    <ol className="p-0 list-none space-y-3">
      {HOW_IT_WORKS.map(({ icon: Icon, text }) => (
        <li key={text} className="flex items-start gap-3" style={metaStyle}>
          <span
            className="inline-flex items-center justify-center h-8 w-8 shrink-0"
            style={{ background: "var(--color-surface-sunken)", borderRadius: 10 }}
          >
            <Icon className="h-4 w-4" style={{ color: "var(--color-text-secondary)" }} />
          </span>
          <span className="pt-1.5">{text}</span>
        </li>
      ))}
    </ol>
  </div>
);

/**
 * `/book` (CR-030) — "Book a court": the venues taking online bookings. A
 * player picks one and lands on its booking page (`/book/:bookingToken`).
 * CR-035: on wide screens the venues are the left column and "Already booked?"
 * plus how booking works sit beside them; phones keep the one column.
 * PLAN-006: booking needs a Google sign-in, so a signed-out player sees the
 * sign-in first and the venues once signed in.
 */
const VenuesPage = () => {
  const {
    signedIn,
    profileRedirect,
    signInAvailable,
    venues,
    total,
    search,
    handleSearch,
    handleClearSearch,
    filterChips,
    filtersOn,
    handleToggleFilter,
    handleClearFilters,
    handleFollow,
    followPending,
    nearMe,
    locating,
    locationError,
    handleNearMe,
    handleClearNearMe,
    isLoading,
    isFetching,
    loadError,
    refetch,
  } = useVenuesPageHooks();

  if (profileRedirect) return <Navigate to={profileRedirect} replace />;

  return (
    <PublicLayout wide>
      <div className="space-y-4">
        {/* PLAN-009 phase C: Courts | Open Play */}
        <DiscoverTabs />
        <div className="pt-2 pb-1">
          <h1
            className="m-0 font-semibold leading-tight"
            style={{ fontSize: 28, letterSpacing: "-0.5px", color: "var(--color-text-dark)" }}
          >
            Book a court
          </h1>
          <p className="m-0 mt-1.5" style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>
            {signedIn
              ? "Pick a venue, then a day, a court and a time."
              : "Sign in with Google, then pick a venue, a day, a court and a time."}
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6 lg:items-start">
          <div className="space-y-4 min-w-0">
            {isLoading ? (
              <Spinner className="py-16" tip="Loading venues…" />
            ) : loadError ? (
              <div style={cardStyle}>
                <ResultState
                  status="error"
                  title="Couldn't load the venues"
                  description="Check your connection and try again."
                  action={
                    <Button onClick={() => refetch()} disabled={isFetching}>
                      <RotateCcw />
                      Try again
                    </Button>
                  }
                />
              </div>
            ) : !signInAvailable ? (
              // PLAN-006: no Google sign-in on this server → no online booking
              <div style={cardStyle}>
                <ResultState
                  status="404"
                  icon={<Store className="w-6 h-6" strokeWidth={1.8} />}
                  title="Online booking isn't available right now"
                  description="Please call the venue or book at the front desk."
                />
              </div>
            ) : !signedIn ? (
              <div style={cardStyle}>
                <ResultState
                  status="404"
                  icon={<LogIn className="w-6 h-6" strokeWidth={1.8} />}
                  title="Sign in to book a court"
                  description="Use your Google account. Your bookings and the videos of every game you play are saved to it — find them any time in My games."
                  action={<GoogleSignInButton returnPath="/book" />}
                />
              </div>
            ) : total === 0 ? (
              <div style={cardStyle}>
                <ResultState
                  status="404"
                  title="No venues take online bookings yet"
                  description="Ask your venue's front desk to book a court."
                />
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  {total > 3 && (
                    <div className="sm:max-w-sm sm:flex-1">
                      <SearchInput
                        value={search}
                        onChange={handleSearch}
                        placeholder="Search by venue or place"
                        width="100%"
                      />
                    </div>
                  )}
                  {/* CR-050: sort by distance from the player (their location stays in the browser) */}
                  {total > 1 && (
                    <Button
                      type="button"
                      variant={nearMe ? "default" : "outline"}
                      className="h-10 shrink-0"
                      onClick={nearMe ? handleClearNearMe : handleNearMe}
                      disabled={locating}
                    >
                      {locating ? <Loader2 className="animate-spin" /> : <LocateFixed />}
                      {locating ? "Finding you…" : nearMe ? "Nearest first · Clear" : "Near me"}
                    </Button>
                  )}
                </div>
                {/* PLAN-009 phase B: what the venue is like */}
                {filterChips.length > 0 && (
                  <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap" role="group" aria-label="Filter venues">
                    {filterChips.map((chip) => (
                      <PickChip
                        key={chip.id}
                        selected={chip.on}
                        onClick={() => handleToggleFilter(chip.id)}
                        className="px-3 h-9 text-[13.5px] whitespace-nowrap"
                      >
                        {chip.label}
                      </PickChip>
                    ))}
                    {filtersOn && (
                      <Button type="button" variant="ghost" className="h-9 shrink-0" onClick={handleClearFilters}>
                        Clear
                      </Button>
                    )}
                  </div>
                )}
                {locationError && (
                  <p className="m-0" style={{ fontSize: 13, color: "var(--color-error)" }}>
                    {locationError}
                  </p>
                )}

                {venues.length === 0 ? (
                  <div style={cardStyle}>
                    <ResultState
                      status="404"
                      title="No venue matches"
                      description={filtersOn ? "Try fewer filters, or another name or place." : "Try another name or place."}
                      action={
                        <Button variant="outline" onClick={handleClearSearch}>
                          Show all venues
                        </Button>
                      }
                    />
                  </div>
                ) : (
                  <ul className="p-0 list-none space-y-3">
                    {venues.map((v) => (
                      <li key={v.key} className="min-w-0 relative">
                        <Link
                          to={v.to}
                          className="h-full p-4 flex items-center gap-3.5"
                          style={{ ...cardStyle, textDecoration: "none" }}
                        >
                          <span
                            className="inline-flex items-center justify-center h-14 w-14 shrink-0 overflow-hidden"
                            style={{
                              background: "var(--color-surface-sunken)",
                              border: "1px solid var(--color-line)",
                              borderRadius: 14,
                            }}
                          >
                            {v.logo ? (
                              <img src={v.logo} alt="" className="h-full w-full object-contain p-1.5" />
                            ) : (
                              <span style={{ fontSize: 20, fontWeight: 600, color: "var(--color-text-secondary)" }}>
                                {v.name.charAt(0).toUpperCase()}
                              </span>
                            )}
                          </span>
                          <span className="min-w-0 flex-1 space-y-1">
                            <span
                              className={`block truncate ${v.directionsUrl ? "pr-34" : "pr-10"}`}
                              style={{ fontSize: 15.5, fontWeight: 600, color: "var(--color-text-dark)" }}
                            >
                              {v.name}
                            </span>
                            {v.address && (
                              <span className="flex items-start gap-1.5" style={metaStyle}>
                                <MapPin className={`${metaIcon} mt-0.5`} />
                                <span className="line-clamp-2">{v.address}</span>
                              </span>
                            )}
                            <span className="flex items-center gap-x-3 gap-y-1 flex-wrap" style={metaStyle}>
                              {v.distance && (
                                <span className="inline-flex items-center gap-1.5" style={{ fontWeight: 600 }}>
                                  <LocateFixed className={metaIcon} />
                                  {v.distance}
                                </span>
                              )}
                              <span className="inline-flex items-center gap-1.5">
                                <LayoutGrid className={metaIcon} />
                                {v.courts}
                              </span>
                              <span
                                className="inline-flex items-center gap-1.5"
                                style={v.openToday ? undefined : { color: "var(--color-text-muted)" }}
                              >
                                <Clock className={metaIcon} />
                                {v.today}
                              </span>
                              {v.followers > 0 && (
                                <span className="inline-flex items-center gap-1.5">
                                  <Users className={metaIcon} />
                                  {v.followers === 1 ? "1 follower" : `${v.followers} followers`}
                                </span>
                              )}
                            </span>
                            {(v.courtFacts || v.amenityText) && (
                              <span className="flex items-start gap-1.5" style={{ ...metaStyle, color: "var(--color-text-muted)" }}>
                                <Sparkles className={`${metaIcon} mt-0.5`} />
                                <span className="line-clamp-2">
                                  {[v.courtFacts, v.amenityText].filter(Boolean).join(" · ")}
                                </span>
                              </span>
                            )}
                          </span>
                          <span
                            className="hidden sm:inline-flex items-center gap-1 shrink-0"
                            style={{ fontSize: 13.5, fontWeight: 600, color: "var(--color-link)" }}
                          >
                            Book
                          </span>
                          <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--color-text-muted)" }} />
                        </Link>
                        {/* PLAN-009 phase B: follow the venue (its own button, not inside the card's link) */}
                        <button
                          type="button"
                          onClick={() => handleFollow(v)}
                          disabled={followPending}
                          aria-pressed={v.following}
                          aria-label={v.following ? `Unfollow ${v.name}` : `Follow ${v.name}`}
                          className="absolute top-2.5 right-3 inline-flex items-center justify-center h-8 w-8 rounded-md transition-colors hover:bg-(--color-surface-sunken) disabled:opacity-60"
                          style={{ color: v.following ? "var(--color-error)" : "var(--color-text-muted)" }}
                        >
                          <Heart className="h-4.5 w-4.5" fill={v.following ? "currentColor" : "none"} />
                        </button>
                        {/* CR-050: its own link (not inside the card's link) */}
                        {v.directionsUrl && (
                          <a
                            href={v.directionsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="absolute top-3 right-12 inline-flex items-center gap-1 px-2 py-1 rounded-md transition-colors hover:bg-(--color-surface-sunken)"
                            style={{ fontSize: 12, fontWeight: 600, color: "var(--color-link)", textDecoration: "none" }}
                            aria-label={`Directions to ${v.name} (Google Maps)`}
                          >
                            <Navigation className="h-3.5 w-3.5" />
                            Directions
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          {/* Beside the list on wide screens; under it on phones */}
          <div className="space-y-4 min-w-0 lg:sticky lg:top-6">
            <FindBookingCard />
            <div className="hidden lg:block">
              <HowItWorksCard />
            </div>
          </div>
        </div>
      </div>
    </PublicLayout>
  );
};

export default VenuesPage;
