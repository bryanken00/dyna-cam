import { Link, Navigate } from "react-router";
import {
  CalendarCheck,
  ChevronRight,
  Clock,
  CreditCard,
  LayoutGrid,
  LogIn,
  MapPin,
  QrCode,
  RotateCcw,
  Store,
  Ticket,
} from "lucide-react";

import { Button } from "@/components/ui/button";

import { useVenuesPageHooks } from "./hooks";
import PublicLayout from "../../../components/layout/PublicLayout";
import ResultState from "../../../components/ResultState";
import SearchInput from "../../../components/SearchInput";
import Spinner from "../../../components/Spinner";
import GoogleSignInButton from "../../../components/player/GoogleSignInButton";

const cardStyle = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-line)",
  borderRadius: "var(--radius-card)",
};

const metaStyle = { fontSize: 13, color: "var(--color-text-secondary)" };
const metaIcon = "h-3.5 w-3.5 shrink-0";

/** "Already booked?" — the way back to a booking without its link. */
const FindBookingCard = () => (
  <Link
    to="/booking"
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
        Find your booking with its code to pay, check in, move or cancel.
      </span>
    </span>
    <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--color-text-muted)" }} />
  </Link>
);

/** CR-035: the three steps, beside the list on wide screens. */
const HOW_IT_WORKS = [
  { icon: LogIn, text: "Sign in with Google — your bookings and game videos stay with your account." },
  { icon: CalendarCheck, text: "Pick a venue, then a day, a court and a time." },
  { icon: CreditCard, text: "Pay online, or at the front desk before your hold runs out." },
  { icon: QrCode, text: "At the court, scan the QR sign and enter your booking code — your game records." },
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
    isLoading,
    isFetching,
    loadError,
    refetch,
  } = useVenuesPageHooks();

  if (profileRedirect) return <Navigate to={profileRedirect} replace />;

  return (
    <PublicLayout wide>
      <div className="space-y-4">
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
                {total > 3 && (
                  <div className="sm:max-w-sm">
                    <SearchInput
                      value={search}
                      onChange={handleSearch}
                      placeholder="Search by venue or place"
                      width="100%"
                    />
                  </div>
                )}

                {venues.length === 0 ? (
                  <div style={cardStyle}>
                    <ResultState
                      status="404"
                      title="No venue matches"
                      description="Try another name or place."
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
                      <li key={v.key} className="min-w-0">
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
                              className="block truncate"
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
                            </span>
                          </span>
                          <span
                            className="hidden sm:inline-flex items-center gap-1 shrink-0"
                            style={{ fontSize: 13.5, fontWeight: 600, color: "var(--color-link)" }}
                          >
                            Book
                          </span>
                          <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--color-text-muted)" }} />
                        </Link>
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
