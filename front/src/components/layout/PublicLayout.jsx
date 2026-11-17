import ThemeToggle from "../ThemeToggle";

const APP_NAME = import.meta.env.VITE_APP_NAME || "Dyna Cam";

/**
 * Chrome for the player pages (`/court/:qrToken`, `/clip/:shareToken`):
 * a slim top bar (brand + theme picker), one narrow mobile-first column, and a
 * footer slot for the privacy note. No login, no sidebar.
 */
const PublicLayout = ({ children, footer }) => (
  <div
    className="min-h-dvh flex flex-col"
    style={{ background: "var(--color-canvas)" }}
  >
    <header
      className="px-4 py-3"
      style={{ borderBottom: "1px solid var(--color-line)" }}
    >
      <div className="mx-auto max-w-md flex items-center justify-between gap-3">
        <span
          className="font-semibold"
          style={{ fontSize: 15, color: "var(--color-text-dark)" }}
        >
          {APP_NAME}
        </span>
        <ThemeToggle />
      </div>
    </header>

    <main className="flex-1 w-full mx-auto max-w-md px-4 py-6">{children}</main>

    {footer && (
      <footer
        className="w-full mx-auto max-w-md px-4 pb-6 text-center"
        style={{
          fontSize: 12.5,
          color: "var(--color-text-muted)",
          paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))",
        }}
      >
        {footer}
      </footer>
    )}
  </div>
);

export default PublicLayout;
