import { Building2, History, ShieldCheck } from "lucide-react";

import { PortalLayout } from "./BasicLayout";
import { useLogoutBackoffice } from "../../services/requests/backoffice/auth";
import { useBackofficeAuthStore } from "../../store/backofficeStore";

// PLAN-008: Companies (phase B), Super admins and Activity (phase E)
const NAVIGATIONS = [
  {
    key: "companies",
    route: "/backoffice/companies",
    name: "Companies",
    label: "Companies",
    icon: <Building2 className="h-5 w-5" />,
    isShow: true,
  },
  {
    key: "admins",
    route: "/backoffice/admins",
    name: "Super admins",
    label: "Super admins",
    icon: <ShieldCheck className="h-5 w-5" />,
    isShow: true,
  },
  {
    key: "activity",
    route: "/backoffice/activity",
    name: "Activity",
    label: "Activity",
    icon: <History className="h-5 w-5" />,
    isShow: true,
  },
];

/**
 * PLAN-008: the back office's frame — the same sidebar and top bar as the Admin
 * portal (PortalLayout), with DGSports' own pages. No permissions: every signed-in
 * super admin sees all three. The account menu opens /backoffice/account-settings.
 */
const BackofficeLayout = () => {
  const admin = useBackofficeAuthStore((s) => s.userData);
  const logout = useLogoutBackoffice();

  return (
    <PortalLayout
      navigations={NAVIGATIONS}
      userData={admin}
      onLogout={() => logout.mutate()}
      subtitle="Back office"
      accountRoute="/backoffice/account-settings"
      defaultTitle="Back office"
    />
  );
};

export default BackofficeLayout;
