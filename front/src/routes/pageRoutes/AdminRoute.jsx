import { Building2, Home, User, Video } from "lucide-react";
import { FileText } from "lucide-react";
import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router";
import BasicLayout from "../../components/layout/BasicLayout";
import { ComponentLoader } from "../../components/LoadingFallback";
import NotFound from "../../components/NotFound";
import { useAdminAuthStore } from "../../store/authStore";
import { Auth, UnAuth } from "../ValidateAuth";
import { ProtectedRoute } from "../../components/ProtectedRoute";

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
// PLAN-003: printable "Book a court" sign for a venue's online booking link
const BookingSign = lazy(() => import("../../pages/Admin/Setup/BookingSign"));
// DGSports (PLAN-001; CR-036 renamed from Dyna Cam): day-to-day work
const Sessions = lazy(() => import("../../pages/Admin/DynaCam/Sessions"));
const Payments = lazy(() => import("../../pages/Admin/DynaCam/Payments"));
// PLAN-003: court bookings at the desk
const Bookings = lazy(() => import("../../pages/Admin/DynaCam/Bookings"));
// PLAN-009 phase C: Open Play sessions
const OpenPlay = lazy(() => import("../../pages/Admin/DynaCam/OpenPlay"));
// PLAN-009 phase D: a session's queue (a tablet at the court)
const OpenPlayQueue = lazy(() => import("../../pages/Admin/DynaCam/OpenPlayQueue"));
// PLAN-009 phase E: tournaments, and one tournament's page
const Tournaments = lazy(() => import("../../pages/Admin/DynaCam/Tournaments"));
const TournamentDetail = lazy(() => import("../../pages/Admin/DynaCam/TournamentDetail"));
// PLAN-009 phase F: clubs
const Clubs = lazy(() => import("../../pages/Admin/DynaCam/Clubs"));

const VENUE_PAGE_ACCESS = [
  { module: "venues", submodule: "list", accessLevel: "read" },
  { module: "venues", submodule: "courts", accessLevel: "read" },
];

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
      name: "DGSports",
      label: "DGSports",
      icon: <Video className="h-5 w-5" />,
      permission: {
        anyOf: [
          { module: "bookings", submodule: null, accessLevel: "read" },
          { module: "open_play", submodule: null, accessLevel: "read" },
          { module: "tournaments", submodule: null, accessLevel: "read" },
          { module: "clubs", submodule: null, accessLevel: "read" },
          { module: "clips", submodule: null, accessLevel: "read" },
          { module: "payments", submodule: null, accessLevel: "read" },
        ],
      },
      isFilter: true,
      isShow: true,
      children: [
        {
          route: "/bookings",
          name: "Bookings",
          label: "Bookings",
          component: (
            <Suspense fallback={<ComponentLoader />}>
              <ProtectedRoute module="bookings" accessLevel="read">
                <Bookings />
              </ProtectedRoute>
            </Suspense>
          ),
          permission: { module: "bookings", submodule: null, accessLevel: "read" },
          isFilter: true,
          isShow: true,
        },
        {
          route: "/open-play",
          name: "Open Play",
          label: "Open Play",
          component: (
            <Suspense fallback={<ComponentLoader />}>
              <ProtectedRoute module="open_play" accessLevel="read">
                <OpenPlay />
              </ProtectedRoute>
            </Suspense>
          ),
          permission: { module: "open_play", submodule: null, accessLevel: "read" },
          isFilter: true,
          isShow: true,
        },
        {
          route: "/tournaments",
          name: "Tournaments",
          label: "Tournaments",
          component: (
            <Suspense fallback={<ComponentLoader />}>
              <ProtectedRoute module="tournaments" accessLevel="read">
                <Tournaments />
              </ProtectedRoute>
            </Suspense>
          ),
          permission: { module: "tournaments", submodule: null, accessLevel: "read" },
          isFilter: true,
          isShow: true,
        },
        {
          route: "/clubs",
          name: "Clubs",
          label: "Clubs",
          component: (
            <Suspense fallback={<ComponentLoader />}>
              <ProtectedRoute module="clubs" accessLevel="read">
                <Clubs />
              </ProtectedRoute>
            </Suspense>
          ),
          permission: { module: "clubs", submodule: null, accessLevel: "read" },
          isFilter: true,
          isShow: true,
        },
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

          {/* PLAN-009 phase E: one tournament — not a sidebar item */}
          <Route
            path="dyna-cam/tournaments/:tournamentId"
            element={
              <Suspense fallback={<ComponentLoader />}>
                <ProtectedRoute module="tournaments" accessLevel="read">
                  <TournamentDetail />
                </ProtectedRoute>
              </Suspense>
            }
          />

          {/* PLAN-009 phase D: an Open Play session's queue — not a sidebar item */}
          <Route
            path="dyna-cam/open-play/:playSessionId/queue"
            element={
              <Suspense fallback={<ComponentLoader />}>
                <ProtectedRoute module="open_play" accessLevel="read">
                  <OpenPlayQueue />
                </ProtectedRoute>
              </Suspense>
            }
          />

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
