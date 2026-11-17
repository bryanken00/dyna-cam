import { Bell, KeyRound, Lock, User } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import PageHeader from "../../../components/PageHeader";
import { useAdminAuthStore } from "../../../store/authStore";
import ProfileSection from "./components/ProfileSection";
import PasswordSection from "./components/PasswordSection";
import NotificationSection from "./components/NotificationSection";

/**
 * Flat settings panel — hairline border, radius 14, no shadow. The heading row
 * is separated from the body by a hairline rule (same chrome as the list card).
 */
const SettingsPanel = ({
  title,
  description,
  icon,
  className = "",
  highlight = false,
  children,
}) => (
  <div
    className={className}
    style={{
      background: "var(--color-surface)",
      border: `1px solid ${highlight ? "var(--color-warning)" : "var(--color-line)"}`,
      borderRadius: "var(--radius-card)",
    }}
  >
    <div
      className="flex items-center gap-3 px-4.5 py-3.5"
      style={{ borderBottom: "1px solid var(--color-line)" }}
    >
      <span
        className="shrink-0"
        style={{
          color: highlight ? "var(--color-warning)" : "var(--color-text-muted)",
        }}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <h2
          className="m-0 font-semibold leading-tight"
          style={{ fontSize: 15, color: "var(--color-text-dark)" }}
        >
          {title}
        </h2>
        <p
          className="m-0 mt-0.5"
          style={{ fontSize: 12.5, color: "var(--color-text-secondary)" }}
        >
          {description}
        </p>
      </div>
    </div>
    <div className="px-4.5 py-5">{children}</div>
  </div>
);

const AccountSettings = () => {
  const mustChangePassword = useAdminAuthStore(
    (s) => s.userData?.mustChangePassword,
  );

  const profilePanel = (
    <SettingsPanel
      key="profile"
      title="Profile Information"
      description="Your name and how we reach you."
      icon={<User className="w-4.25 h-4.25" strokeWidth={1.8} />}
    >
      <ProfileSection />
    </SettingsPanel>
  );

  const passwordPanel = (
    <SettingsPanel
      key="password"
      title="Change Password"
      description={
        mustChangePassword
          ? "Required — choose a password only you know."
          : "Update the password you use to sign in."
      }
      icon={<Lock className="w-4.25 h-4.25" strokeWidth={1.8} />}
      highlight={mustChangePassword}
    >
      <PasswordSection />
    </SettingsPanel>
  );

  return (
    <div className="p-8 space-y-5">
      {/* 1. HEADER */}
      <PageHeader
        title="Account Settings"
        subtitle="Manage your profile, security, and preferences."
      />

      {/* Forced password change — the <Auth> guard keeps the user on this page */}
      {mustChangePassword && (
        <Alert variant="warning">
          <KeyRound />
          <AlertTitle>Change your password to continue</AlertTitle>
          <AlertDescription>
            This account is still using a temporary password. The menu and the
            rest of the app stay locked until you set a new password in Change
            Password below.
          </AlertDescription>
        </Alert>
      )}

      {/* 2. SETTINGS PANELS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5">
        {/* While a change is pending, the password panel comes first */}
        <div className="lg:col-span-2 space-y-3.5">
          {mustChangePassword ? (
            <>
              {passwordPanel}
              {profilePanel}
            </>
          ) : (
            <>
              {profilePanel}
              {passwordPanel}
            </>
          )}
        </div>

        <SettingsPanel
          title="Notifications"
          description="Choose what you get told about."
          icon={<Bell className="w-4.25 h-4.25" strokeWidth={1.8} />}
          className="h-full"
        >
          <NotificationSection />
        </SettingsPanel>
      </div>
    </div>
  );
};

export default AccountSettings;
