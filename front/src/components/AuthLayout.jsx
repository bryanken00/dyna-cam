import dayjs from "dayjs";
import { Link } from "react-router";

import CourtMark from "./brand/CourtMark";
import HeroCourt from "./brand/HeroCourt";

const APP_NAME = import.meta.env.VITE_APP_NAME || "Dyna Cam";

/**
 * Shared chrome for every auth page — login, forgot-password and
 * reset-password — in the landing page's pickleball look (CR-011): the
 * navy band with the brand court on one side, the page's form on the
 * other. On a phone the band shrinks to a strip above the form.
 *
 * Each page owns only what sits inside the form panel, so they can't drift
 * apart.
 */
const AuthLayout = ({ children }) => (
  <div
    className="min-h-screen grid grid-rows-[auto_1fr] lg:grid-rows-1 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]"
    style={{ background: "var(--color-canvas)" }}
  >
    {/* The blue court band */}
    <aside
      className="on-court flex flex-col px-6 sm:px-10 py-6 lg:py-10"
      style={{ background: "var(--color-brand-court)" }}
    >
      <Link
        to="/"
        className="inline-flex items-center gap-2.5 self-start"
        style={{ textDecoration: "none" }}
      >
        <CourtMark />
        <span
          className="font-semibold"
          style={{ fontSize: 15.5, color: "var(--color-brand-on-court)" }}
        >
          {APP_NAME}
        </span>
      </Link>

      <div className="hidden lg:flex flex-1 flex-col justify-center py-10">
        <div className="max-w-xl w-full mx-auto">
          <HeroCourt />
          <p
            className="m-0 mt-10 max-w-md"
            style={{
              fontSize: 26,
              lineHeight: 1.2,
              fontWeight: 600,
              letterSpacing: "-0.6px",
              color: "var(--color-brand-on-court)",
            }}
          >
            Courts, games, replays and payments, all in one place.
          </p>
        </div>
      </div>

      <p
        className="hidden lg:block m-0"
        style={{ fontSize: 12.5, color: "rgb(255 255 255 / 0.7)" }}
      >
        © {dayjs().year()} {APP_NAME}
      </p>
    </aside>

    {/* The form */}
    <main className="flex items-center justify-center px-4 py-10 sm:px-8">
      <div className="w-full max-w-sm">
        {children}
        <p
          className="lg:hidden m-0 mt-10 text-center"
          style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}
        >
          © {dayjs().year()} {APP_NAME}
        </p>
      </div>
    </main>
  </div>
);

export default AuthLayout;
