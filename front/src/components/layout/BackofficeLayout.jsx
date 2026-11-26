import { Building2, History, LogOut, ShieldCheck } from "lucide-react";
import { Link, NavLink, Outlet } from "react-router";
import { Button } from "@/components/ui/button";

import DGMark from "../brand/DGMark";
import Wordmark from "../brand/Wordmark";
import ThemeToggle from "../ThemeToggle";
import { useLogoutBackoffice } from "../../services/requests/backoffice/auth";
import { useBackofficeAuthStore } from "../../store/backofficeStore";

// PLAN-008: Companies (phase B), Super admins and Activity (phase E)
const NAV = [
  { to: "/backoffice/companies", label: "Companies", Icon: Building2 },
  { to: "/backoffice/admins", label: "Super admins", Icon: ShieldCheck },
  { to: "/backoffice/activity", label: "Activity", Icon: History },
];

/**
 * PLAN-008 phase B: the back office's frame — DGSports' own pages for onboarding
 * and managing companies. A light top bar (brand, "Back office", the pages, the
 * signed-in super admin — a link to Your account — theme, sign out) over the page;
 * no sidebar, no permissions.
 */
const BackofficeLayout = () => {
  const admin = useBackofficeAuthStore((s) => s.userData);
  const logout = useLogoutBackoffice();

  return (
    <div className="min-h-screen" style={{ background: "var(--color-canvas)" }}>
      <header
        className="sticky top-0 z-30"
        style={{ background: "var(--color-surface)", borderBottom: "1px solid var(--color-line)" }}
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-8 h-14 flex items-center gap-4">
          <Link to="/backoffice/companies" className="inline-flex items-center gap-2.5 shrink-0" style={{ textDecoration: "none" }}>
            <DGMark size={26} />
            <Wordmark size={15.5} />
          </Link>
          <span
            className="hidden sm:inline-flex items-center px-2 py-0.5 uppercase"
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: "0.08em",
              borderRadius: 6,
              border: "1px solid var(--color-line)",
              color: "var(--color-text-secondary)",
            }}
          >
            Back office
          </span>
          <nav className="flex items-center gap-1 ml-2 overflow-x-auto">
            {NAV.map(({ to, label, Icon }) => (
              <NavLink
                key={to}
                to={to}
                className="inline-flex items-center gap-2 h-9 px-3 rounded-lg shrink-0 transition-colors hover:bg-(--color-surface-sunken)"
                style={({ isActive }) => ({
                  fontSize: 13.5,
                  fontWeight: 500,
                  color: isActive ? "var(--color-text-dark)" : "var(--color-text-secondary)",
                  background: isActive ? "var(--color-surface-sunken)" : undefined,
                  textDecoration: "none",
                })}
              >
                <Icon className="w-4 h-4" />
                <span className="hidden sm:inline">{label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2 min-w-0">
            <Link
              to="/backoffice/account-settings"
              className="hidden md:block truncate hover:underline"
              style={{ fontSize: 13, color: "var(--color-text-secondary)", textDecoration: "none" }}
            >
              {admin ? `${admin.firstName} ${admin.lastName}` : "Your account"}
            </Link>
            <ThemeToggle />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
            >
              <LogOut />
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl">
        <Outlet />
      </main>
    </div>
  );
};

export default BackofficeLayout;
