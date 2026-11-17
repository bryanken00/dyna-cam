import { Home, User, Video } from "lucide-react";
import { FileText, Settings } from "lucide-react";
import { Suspense, lazy } from "react";
import { Route, Routes } from "react-router";
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
const SettingsPage = lazy(() => import("../../pages/Admin/Settings"));
const AuditTrail = lazy(() => import("../../pages/Admin/AuditTrail"));
const AccountSettings = lazy(() => import("../../pages/Admin/AccountSettings"));
// Dyna Cam (PLAN-001)
const Venues = lazy(() => import("../../pages/Admin/DynaCam/Venues"));
const Courts = lazy(() => import("../../pages/Admin/DynaCam/Courts"));
const CourtSign = lazy(
  () => import("../../pages/Admin/DynaCam/Courts/PrintSign"),
);
const Devices = lazy(() => import("../../pages/Admin/DynaCam/Devices"));
const Clips = lazy(() => import("../../pages/Admin/DynaCam/Clips"));

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
      key: "dyna-cam",
      name: "Dyna Cam",
      label: "Dyna Cam",
      icon: <Video className="h-5 w-5" />,
      permission: {
        anyOf: [
          { module: "venues", submodule: "list", accessLevel: "read" },
          { module: "venues", submodule: "courts", accessLevel: "read" },
          { module: "venues", submodule: "devices", accessLevel: "read" },
          { module: "clips", submodule: null, accessLevel: "read" },
        ],
      },
      isFilter: true,
      isShow: true,
      children: [
        {
          route: "/venues",
          name: "Venues",
          label: "Venues",
          component: (
            <Suspense fallback={<ComponentLoader />}>
              <ProtectedRoute
                module="venues"
                submodule="list"
                accessLevel="read"
              >
                <Venues />
              </ProtectedRoute>
            </Suspense>
          ),
          permission: {
            module: "venues",
            submodule: "list",
            accessLevel: "read",
          },
          isFilter: true,
          isShow: true,
        },
        {
          route: "/courts",
          name: "Courts",
          label: "Courts",
          component: (
            <Suspense fallback={<ComponentLoader />}>
              <ProtectedRoute
                module="venues"
                submodule="courts"
                accessLevel="read"
              >
                <Courts />
              </ProtectedRoute>
            </Suspense>
          ),
          permission: {
            module: "venues",
            submodule: "courts",
            accessLevel: "read",
          },
          isFilter: true,
          isShow: true,
        },
        {
          route: "/devices",
          name: "Recorder boxes",
          label: "Recorder boxes",
          component: (
            <Suspense fallback={<ComponentLoader />}>
              <ProtectedRoute
                module="venues"
                submodule="devices"
                accessLevel="read"
              >
                <Devices />
              </ProtectedRoute>
            </Suspense>
          ),
          permission: {
            module: "venues",
            submodule: "devices",
            accessLevel: "read",
          },
          isFilter: true,
          isShow: true,
        },
        {
          route: "/clips",
          name: "Clips",
          label: "Clips",
          component: (
            <Suspense fallback={<ComponentLoader />}>
              <ProtectedRoute module="clips" accessLevel="read">
                <Clips />
              </ProtectedRoute>
            </Suspense>
          ),
          permission: { module: "clips", submodule: null, accessLevel: "read" },
          isFilter: true,
          isShow: true,
        },
      ],
    },
    {
      route: "/settings",
      name: "Settings",
      label: "Settings",
      icon: <Settings className="h-5 w-5" />,
      component: (
        <Suspense fallback={<ComponentLoader />}>
          <ProtectedRoute module="settings" accessLevel="read">
            <SettingsPage />
          </ProtectedRoute>
        </Suspense>
      ),
      permission: { module: "settings", submodule: null, accessLevel: "read" },
      isFilter: true,
      isShow: true,
      section: "system", // renders below the sidebar divider
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
            Opened in a new tab from Courts → "Print QR sign". */}
        <Route
          path="dyna-cam/courts/:courtId/print"
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
