import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { Suspense, lazy } from "react";
import { ComponentLoader } from "../components/LoadingFallback";
import AdminRoute from "./pageRoutes/AdminRoute";

const LandingPage = lazy(() => import("../pages/LandingPage"));
// Developer page: every shared component in both themes. Not linked from the product.
const ComponentGallery = lazy(() => import("../pages/ComponentGallery"));
// Player pages (PLAN-001) — no login; the QR code / share link is the credential.
const PublicCourt = lazy(() => import("../pages/Public/Court"));
const PublicClip = lazy(() => import("../pages/Public/Clip"));
const PublicSession = lazy(() => import("../pages/Public/Session"));

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
        <Route path="/admin/*" element={<AdminRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default RootRoutes;
