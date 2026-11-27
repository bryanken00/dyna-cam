import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { Suspense, lazy } from "react";
import { ComponentLoader } from "../components/LoadingFallback";

// PLAN-009: the player app. The paths are the ones the main app used before
// (PLAN-003 / PLAN-006 / CR-030), so booking links in emails, the Xendit return
// and the Google sign-in return keep working once PLAYER_APP_URL points here.
// Discover: every venue taking bookings (CR-030, Near me CR-050)
const PublicVenues = lazy(() => import("../pages/Public/Venues"));
// A venue's booking page — its booking link is the credential (PLAN-003)
const PublicBook = lazy(() => import("../pages/Public/Book"));
// One booking's own page — pay, check in, cancel, move (PLAN-003, CR-046/047)
const PublicBooking = lazy(() => import("../pages/Public/Booking"));
// Back from Google (PLAN-006)
const PublicSignedIn = lazy(() => import("../pages/Public/SignedIn"));
// Play: the player's bookings and games (PLAN-006)
const PublicMyGames = lazy(() => import("../pages/Public/MyGames"));
// Profile: name + phone, completed on the first sign-in (PLAN-006)
const PublicProfile = lazy(() => import("../pages/Public/Profile"));
// PLAN-009 phase C: Open Play — the week's sessions, and one session's page
const OpenPlay = lazy(() => import("../pages/Public/OpenPlay"));
const OpenPlaySession = lazy(() => import("../pages/Public/OpenPlaySession"));
// PLAN-009 phase E: tournaments, one tournament, and the partner's invite
const Events = lazy(() => import("../pages/Public/Events"));
const Event = lazy(() => import("../pages/Public/Event"));
const TeamInvite = lazy(() => import("../pages/Public/TeamInvite"));
// PLAN-009 phase F: clubs (the Clubs tab), one club, and coaching (clinics)
const Clubs = lazy(() => import("../pages/Public/Clubs"));
const Club = lazy(() => import("../pages/Public/Club"));
const Coaching = lazy(() => import("../pages/Public/Coaching"));

const page = (element) => <Suspense fallback={<ComponentLoader />}>{element}</Suspense>;

const RootRoutes = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/book" replace />} />
        <Route path="/book" element={page(<PublicVenues />)} />
        <Route path="/book/:bookingToken" element={page(<PublicBook />)} />
        {/* CR-045: Find my booking is gone — a player's bookings are in My games */}
        <Route path="/booking" element={<Navigate to="/me/games" replace />} />
        <Route path="/booking/:manageToken" element={page(<PublicBooking />)} />
        <Route path="/signed-in" element={page(<PublicSignedIn />)} />
        <Route path="/me/games" element={page(<PublicMyGames />)} />
        <Route path="/me/profile" element={page(<PublicProfile />)} />
        <Route path="/open-play" element={page(<OpenPlay />)} />
        <Route path="/open-play/:playToken" element={page(<OpenPlaySession />)} />
        <Route path="/events" element={page(<Events />)} />
        <Route path="/events/:tournamentKey" element={page(<Event />)} />
        <Route path="/team-invite/:inviteToken" element={page(<TeamInvite />)} />
        <Route path="/clubs" element={page(<Clubs />)} />
        <Route path="/clubs/:clubKey" element={page(<Club />)} />
        <Route path="/coaching" element={page(<Coaching />)} />
        <Route path="*" element={<Navigate to="/book" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default RootRoutes;
