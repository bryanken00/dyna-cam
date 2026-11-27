import { Navigate, Outlet, useLocation } from "react-router";

export const Auth = ({ store, redirect }) => {
  const token = store((state) => state.token);
  const mustChangePassword = store(
    (state) => state.userData?.mustChangePassword,
  );
  const { pathname } = useLocation();

  if (!token) {
    return <Navigate to={redirect} replace />;
  }

  // A forced password change is pending (e.g. the seeded Owner's first login).
  // The backend refuses everything else until it is done, so the only
  // reachable page is Account Settings, where the password form lives.
  // `redirect` is the portal root ("/admin").
  const settingsPath = `${redirect}/account-settings`;
  if (mustChangePassword && pathname.replace(/\/+$/, "") !== settingsPath) {
    return <Navigate to={settingsPath} replace />;
  }

  return <Outlet />;
};

export const UnAuth = ({ store, redirect }) => {
  const token = store((state) => state.token);

  if (token) {
    return <Navigate to={redirect} replace />;
  }

  return <Outlet />;
};
