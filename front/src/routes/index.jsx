import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { Suspense, lazy } from "react";
import { ComponentLoader } from "../components/LoadingFallback";
// PLAN-009: the player pages move to the player app (web-app/) once VITE_PLAYER_APP_URL is set
import PlayerAppRedirect from "../components/PlayerAppRedirect";
import AdminRoute from "./pageRoutes/AdminRoute";
import BackofficeRoute from "./pageRoutes/BackofficeRoute";

const LandingPage = lazy(() => import("../pages/LandingPage"));
// Developer page: every shared component in both themes. Not linked from the product.
const ComponentGallery = lazy(() => import("../pages/ComponentGallery"));
// Player pages (PLAN-001) — no login; the QR code / share link is the credential.
const PublicCourt = lazy(() => import("../pages/Public/Court"));
const PublicClip = lazy(() => import("../pages/Public/Clip"));
const PublicSession = lazy(() => import("../pages/Public/Session"));
// A player streams their session to their own Facebook / YouTube (PLAN-002
// Phase G) — the setup code from the session device's QR is the credential.
const PublicStream = lazy(() => import("../pages/Public/Stream"));
// Court booking (PLAN-003) — the venue's booking link / a booking's own link
const PublicBook = lazy(() => import("../pages/Public/Book"));
const PublicBooking = lazy(() => import("../pages/Public/Booking"));
// CR-030: the way in for players — every venue taking bookings, and Find my booking
const PublicVenues = lazy(() => import("../pages/Public/Venues"));
const PublicPaymentSandbox = lazy(() => import("../pages/Public/PaymentSandbox")); // CR-033
const PublicBoard = lazy(() => import("../pages/Public/Board")); // CR-038: a venue's TV court board
const PublicSignedIn = lazy(() => import("../pages/Public/SignedIn")); // PLAN-006: back from Google
const PublicMyGames = lazy(() => import("../pages/Public/MyGames")); // PLAN-006: the player's game log
const PublicProfile = lazy(() => import("../pages/Public/Profile")); // PLAN-006: name + phone, first sign-in

const RootRoutes = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            <Suspense fallback={<ComponentLoader />}>
              <LandingPage />
            </Suspense>
          }
        />
        <Route
          path="/components"
          element={
            <Suspense fallback={<ComponentLoader />}>
              <ComponentGallery />
            </Suspense>
          }
        />
        <Route
          path="/court/:qrToken"
          element={
            <Suspense fallback={<ComponentLoader />}>
              <PublicCourt />
            </Suspense>
          }
        />
        <Route
          path="/clip/:shareToken"
          element={
            <Suspense fallback={<ComponentLoader />}>
              <PublicClip />
            </Suspense>
          }
        />
        <Route
          path="/session/:shareToken"
          element={
            <Suspense fallback={<ComponentLoader />}>
              <PublicSession />
            </Suspense>
          }
        />
        <Route
          path="/stream/:code"
          element={
            <Suspense fallback={<ComponentLoader />}>
              <PublicStream />
            </Suspense>
          }
        />
        <Route
          path="/book"
          element={
            <PlayerAppRedirect>
              <Suspense fallback={<ComponentLoader />}>
                <PublicVenues />
              </Suspense>
            </PlayerAppRedirect>
          }
        />
        {/* CR-045: Find my booking is gone — a player's bookings are in My games */}
        <Route path="/booking" element={<Navigate to="/me/games" replace />} />
        <Route
          path="/book/:bookingToken"
          element={
            <PlayerAppRedirect>
              <Suspense fallback={<ComponentLoader />}>
                <PublicBook />
              </Suspense>
            </PlayerAppRedirect>
          }
        />
        <Route
          path="/booking/:manageToken"
          element={
            <PlayerAppRedirect>
              <Suspense fallback={<ComponentLoader />}>
                <PublicBooking />
              </Suspense>
            </PlayerAppRedirect>
          }
        />
        <Route
          path="/payment-sandbox/:checkoutId"
          element={
            <Suspense fallback={<ComponentLoader />}>
              <PublicPaymentSandbox />
            </Suspense>
          }
        />
        <Route
          path="/board/:displayToken"
          element={
            <Suspense fallback={<ComponentLoader />}>
              <PublicBoard />
            </Suspense>
          }
        />
        <Route
          path="/signed-in"
          element={
            <PlayerAppRedirect>
              <Suspense fallback={<ComponentLoader />}>
                <PublicSignedIn />
              </Suspense>
            </PlayerAppRedirect>
          }
        />
        <Route
          path="/me/games"
          element={
            <PlayerAppRedirect>
              <Suspense fallback={<ComponentLoader />}>
                <PublicMyGames />
              </Suspense>
            </PlayerAppRedirect>
          }
        />
        <Route
          path="/me/profile"
          element={
            <PlayerAppRedirect>
              <Suspense fallback={<ComponentLoader />}>
                <PublicProfile />
              </Suspense>
            </PlayerAppRedirect>
          }
        />
        <Route path="/admin/*" element={<AdminRoute />} />
        {/* PLAN-008 phase B: DGSports' back office — onboard and manage companies */}
        <Route path="/backoffice/*" element={<BackofficeRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default RootRoutes;
