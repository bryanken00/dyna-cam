import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router";

import BackofficeLayout from "../../components/layout/BackofficeLayout";
import { ComponentLoader } from "../../components/LoadingFallback";
import NotFound from "../../components/NotFound";
import { useBackofficeAuthStore } from "../../store/backofficeStore";
import { Auth, UnAuth } from "../ValidateAuth";

/**
 * PLAN-008 phase B: the back office — /backoffice/*. DGSports' super admins only,
 * with their own sign-in (useBackofficeAuthStore); no permissions (any signed-in
 * super admin sees everything here). A temporary password keeps them on
 * /backoffice/account-settings until changed (the <Auth> guard).
 */
const Login = lazy(() => import("../../pages/Backoffice/Login"));
const Account = lazy(() => import("../../pages/Backoffice/Account"));
const Companies = lazy(() => import("../../pages/Backoffice/Companies"));
const CompanyDetail = lazy(() => import("../../pages/Backoffice/CompanyDetail"));
// Phase E: super admins and the back office's own audit trail
const Admins = lazy(() => import("../../pages/Backoffice/Admins"));
const Activity = lazy(() => import("../../pages/Backoffice/Activity"));

const page = (Component) => (
  <Suspense fallback={<ComponentLoader />}>
    <Component />
  </Suspense>
);

const BackofficeRoute = () => (
  <Routes>
    <Route element={<UnAuth store={useBackofficeAuthStore} redirect="/backoffice/companies" />}>
      <Route path="/" index element={page(Login)} />
    </Route>

    <Route element={<Auth store={useBackofficeAuthStore} redirect="/backoffice" />}>
      <Route element={<BackofficeLayout />}>
        <Route path="companies" element={page(Companies)} />
        <Route path="companies/:companyId" element={page(CompanyDetail)} />
        <Route path="admins" element={page(Admins)} />
        <Route path="activity" element={page(Activity)} />
        <Route path="account-settings" element={page(Account)} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Route>

    <Route path="*" element={<Navigate to="/backoffice" replace />} />
  </Routes>
);

export default BackofficeRoute;
