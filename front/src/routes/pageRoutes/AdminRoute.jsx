import { Building2, Home, User, Video } from "lucide-react";
import { FileText } from "lucide-react";
import { Suspense, lazy } from "react";
import { Navigate, Route, Routes, useParams } from "react-router";
import BasicLayout from "../../components/layout/BasicLayout";
import { ComponentLoader } from "../../components/LoadingFallback";
import NotFound from "../../components/NotFound";
import { useAdminAuthStore } from "../../store/authStore";
import { Auth, UnAuth } from "../ValidateAuth";
import { ProtectedRoute } from "../../components/ProtectedRoute";
import { courtSignPath } from "../../utils/dynaCam";

const Login = lazy(() => import("../../pages/Admin/Login"));
const ForgotPassword = lazy(() => import("../../pages/Auth/ForgotPassword"));
const ResetPassword = lazy(() => import("../../pages/Auth/ResetPassword"));
const Dashboard = lazy(() => import("../../pages/Admin/Dashboard"));
const Users = lazy(() => import("../../pages/Admin/UserManagement/Users"));
const Roles = lazy(() => import("../../pages/Admin/UserManagement/Roles"));
const AuditTrail = lazy(() => import("../../pages/Admin/AuditTrail"));
const AccountSettings = lazy(() => import("../../pages/Admin/AccountSettings"));
// Setup (PLAN-002): venues → courts → camera setup. Recorder boxes have no
// screen (Phase I): they enrol from their .env with the venue's ID.
const Venues = lazy(() => import("../../pages/Admin/Setup/Venues"));
const VenueDetail = lazy(() => import("../../pages/Admin/Setup/VenueDetail"));
const CourtSetup = lazy(() => import("../../pages/Admin/Setup/CourtSetup"));
const CourtSign = lazy(() => import("../../pages/Admin/Setup/CourtSign"));
// PLAN-003: printable "Book a court" sign for a venue's online booking link
const BookingSign = lazy(() => import("../../pages/Admin/Setup/BookingSign"));
// Dyna Cam (PLAN-001): day-to-day work
const Sessions = lazy(() => import("../../pages/Admin/DynaCam/Sessions"));
const Payments = lazy(() => import("../../pages/Admin/DynaCam/Payments"));

const VENUE_PAGE_ACCESS = [
  { module: "venues", submodule: "list", accessLevel: "read" },
  { module: "venues", submodule: "courts", accessLevel: "read" },
];

/** Old print-sign links (PLAN-001) → the Setup route, keeping the court. */
const LegacyCourtSignRedirect = () => {
  const { courtId } = useParams();
  return <Navigate to={courtSignPath(courtId)} replace />;
};

const AdminRoute = () => {
  const navigations = [
    {
      route: "/dashboard",
      name: "Dashboard",
      label: "Dashboard",
      icon: <Home className="h-5 w-5" />,
      component: (
        <Suspense fallback={<ComponentLoader />}>
          <ProtectedRoute module="dashboard" accessLevel="read">
            <Dashboard />
          </ProtectedRoute>
        </Suspense>
      ),
      permission: { module: "dashboard", submodule: null, accessLevel: "read" },
      isFilter: true,
      isShow: true,
    },
    {
      // CR-019: its own item — Setup had only Venues. The address stays
      // /admin/setup/venues (venue and court pages, Google Drive's return link)
      route: "/setup/venues",
      name: "Venues",
      label: "Venues",
      icon: <Building2 className="h-5 w-5" />,
      component: (
        <Suspense fallback={<ComponentLoader />}>
          <ProtectedRoute anyOf={VENUE_PAGE_ACCESS}>
            <Venues />
          </ProtectedRoute>
        </Suspense>
      ),
      permission: { anyOf: VENUE_PAGE_ACCESS },
      isFilter: true,
      isShow: true,
    },
    {
      key: "dyna-cam",
      name: "Dyna Cam",
      label: "Dyna Cam",
      icon: <Video className="h-5 w-5" />,
      permission: {
        anyOf: [
          { module: "clips", submodule: null, accessLevel: "read" },
          { module: "payments", submodule: null, accessLevel: "read" },
        ],
      },
      isFilter: true,
      isShow: true,
      children: [
        {
          route: "/sessions",
          name: "Sessions",
          label: "Sessions",
          component: (
            <Suspense fallback={<ComponentLoader />}>
              <ProtectedRoute module="clips" accessLevel="read">
                <Sessions />
              </ProtectedRoute>
            </Suspense>
          ),
          permission: { module: "clips", submodule: null, accessLevel: "read" },
          isFilter: true,
          isShow: true,
        },
        {
          route: "/payments",
          name: "Payments",
          label: "Payments",
          component: (
            <Suspense fallback={<ComponentLoader />}>
              <ProtectedRoute module="payments" accessLevel="read">
                <Payments />
              </ProtectedRoute>
            </Suspense>
          ),
          permission: {
            module: "payments",
            submodule: null,
            accessLevel: "read",
          },
          isFilter: true,
          isShow: true,
        },
      ],
    },
    {
      key: "user-management",
      name: "User Management",
      label: "User Management",
      icon: <User className="h-5 w-5" />,
      permission: {
        anyOf: [
          { module: "users", submodule: "list", accessLevel: "read" },
          { module: "users", submodule: "roles", accessLevel: "read" },
        ],
      },
      isFilter: true,
      isShow: true,
      section: "system", // CR-019: below the divider, above Audit Trail
      children: [
        {
          route: "/users",
          name: "Users",
          label: "Users",
          component: (
            <Suspense fallback={<ComponentLoader />}>
              <ProtectedRoute
                module="users"
                submodule="list"
                accessLevel="read"
              >
                <Users />
              </ProtectedRoute>
            </Suspense>
          ),
          permission: {
            module: "users",
            submodule: "list",
            accessLevel: "read",
          },
          isFilter: true,
          isShow: true,
        },
        {
          route: "/roles",
          name: "Roles",
          label: "Roles",
          component: (
            <Suspense fallback={<ComponentLoader />}>
              <ProtectedRoute
                module="users"
                submodule="roles"
                accessLevel="read"
              >
                <Roles />
              </ProtectedRoute>
            </Suspense>
          ),
          permission: {
            module: "users",
            submodule: "roles",
            accessLevel: "read",
          },
          isFilter: true,
          isShow: true,
        },
      ],
    },
    {
      route: "/audit-trail",
      name: "Audit Trail",
      label: "Audit Trail",
      icon: <FileText className="h-5 w-5" />,
      component: (
        <Suspense fallback={<ComponentLoader />}>
          <ProtectedRoute module="audit_trail" accessLevel="read">
            <AuditTrail />
          </ProtectedRoute>
        </Suspense>
      ),
      permission: {
        module: "audit_trail",
        submodule: null,
        accessLevel: "read",
      },
      isFilter: true,
      isShow: true,
      section: "system", // renders below the sidebar divider
    },
  ].map((page) => {
    if (page.children) {
      return {
        ...page,
        children: page.children.map((child) => ({
          ...child,
          route: `/admin/${page.key}` + child.route,
        })),
      };
    }
    return { ...page, route: "/admin" + page.route };
  });

  return (
    <Routes>
      <Route
        element={
          <UnAuth store={useAdminAuthStore} redirect="/admin/dashboard" />
        }
      >
        <Route
          path="/"
          index
          element={
            <Suspense fallback={<ComponentLoader />}>
              <Login />
            </Suspense>
          }
        />
        <Route
          path="forgot-password"
          element={
            <Suspense fallback={<ComponentLoader />}>
              <ForgotPassword />
            </Suspense>
          }
        />
        <Route
          path="reset-password"
          element={
            <Suspense fallback={<ComponentLoader />}>
              <ResetPassword />
            </Suspense>
          }
        />
      </Route>

      <Route element={<Auth store={useAdminAuthStore} redirect="/admin" />}>
        {/* Printable A5 court sign — full page, outside the sidebar layout.
            Opened in a new tab from a venue's courts or the court page. */}
        <Route
          path="setup/courts/:courtId/print"
          element={
            <Suspense fallback={<ComponentLoader />}>
              <ProtectedRoute
                module="venues"
                submodule="courts"
                accessLevel="read"
              >
                <CourtSign />
              </ProtectedRoute>
            </Suspense>
          }
        />
        {/* PLAN-003: printable A5 "Book a court" sign — full page, new tab */}
        <Route
          path="setup/venues/:venueId/booking-sign"
          element={
            <Suspense fallback={<ComponentLoader />}>
              <ProtectedRoute module="bookings" accessLevel="read">
                <BookingSign />
              </ProtectedRoute>
            </Suspense>
          }
        />
        {/* PLAN-001 routes → their Setup homes (bookmarks, printed links) */}
        <Route
          path="dyna-cam/courts/:courtId/print"
          element={<LegacyCourtSignRedirect />}
        />
        <Route
          path="dyna-cam/venues"
          element={<Navigate to="/admin/setup/venues" replace />}
        />
        <Route
          path="dyna-cam/courts"
          element={<Navigate to="/admin/setup/venues" replace />}
        />
        {/* PLAN-002 Phase I: recorder boxes are set up from .env, no page */}
        <Route
          path="dyna-cam/devices"
          element={<Navigate to="/admin/setup/venues" replace />}
        />
        <Route
          path="setup/recorder-boxes"
          element={<Navigate to="/admin/setup/venues" replace />}
        />
        {/* CR-024: the Clips page was removed — games are in Sessions */}
        <Route
          path="dyna-cam/clips"
          element={<Navigate to="/admin/dyna-cam/sessions" replace />}
        />
        {/* PLAN-002 Phase E: devices are paired to a session now */}
        <Route
          path="dyna-cam/paired-apps"
          element={<Navigate to="/admin/dyna-cam/sessions" replace />}
        />

        <Route
          element={
            <BasicLayout navigations={navigations} store={useAdminAuthStore} />
          }
        >
          {navigations
            .filter((page) => page.isShow)
            .flatMap((page) => {
              if (page.children) {
                return page.children
                  .filter((child) => child.isShow)
                  .map((child) => {
                    const routePath = child.route.replace("/admin/", "");
                    return (
                      <Route
                        key={child.route}
                        path={routePath}
                        element={child.component}
                      />
                    );
                  });
              }
              const routePath = page.route.replace("/admin/", "");
              return (
                <Route
                  key={page.route}
                  path={routePath}
                  element={page.component}
                />
              );
            })}

          {/* Setup detail pages — not sidebar items; "Venues" stays highlighted */}
          <Route
            path="setup/venues/:venueId"
            element={
              <Suspense fallback={<ComponentLoader />}>
                <ProtectedRoute anyOf={VENUE_PAGE_ACCESS}>
                  <VenueDetail />
                </ProtectedRoute>
              </Suspense>
            }
          />
          <Route
            path="setup/venues/:venueId/courts/:courtId"
            element={
              <Suspense fallback={<ComponentLoader />}>
                <ProtectedRoute
                  module="venues"
                  submodule="courts"
                  accessLevel="read"
                >
                  <CourtSetup />
                </ProtectedRoute>
              </Suspense>
            }
          />

          <Route
            path="account-settings"
            element={
              <Suspense fallback={<ComponentLoader />}>
                <AccountSettings />
              </Suspense>
            }
          />

          <Route path="*" element={<NotFound homePath="/admin/dashboard" />} />
        </Route>
      </Route>
    </Routes>
  );
};

export default AdminRoute;
