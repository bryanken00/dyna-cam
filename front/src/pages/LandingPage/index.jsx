import { useNavigate } from "react-router";
import {
  ArrowRight,
  Clapperboard,
  CreditCard,
  Image,
  QrCode,
  Radio,
  ShieldCheck,
  Smartphone,
  Timer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import ThemeToggle from "@/components/ThemeToggle";

const APP_NAME = import.meta.env.VITE_APP_NAME || "Dyna Cam";

/** The player's flow, in the order it happens on court. */
const STEPS = [
  {
    icon: QrCode,
    title: "Scan the court QR",
    body: "Every court has its own code. Point your phone camera at it — no app to install.",
  },
  {
    icon: Timer,
    title: "Save the last 60 seconds",
    body: "Just won a great rally? Tap save, or press the court button. The camera was already recording.",
  },
  {
    icon: Smartphone,
    title: "Get the clip on your phone",
    body: "A link to your replay arrives in moments, ready to download or share.",
  },
];

/** What a venue gets. Kept to what PLAN-001 actually builds. */
const FEATURES = [
  {
    icon: Image,
    title: "Your logo on every clip",
    body: "Each shared replay carries your venue's branding.",
  },
  {
    icon: Clapperboard,
    title: "Full-session recording",
    body: "Record a whole booked session, not just one rally.",
  },
  {
    icon: Radio,
    title: "Live streaming",
    body: "Stream a court to YouTube or Facebook for tournaments and events.",
  },
  {
    icon: CreditCard,
    title: "Paid clips",
    body: "Charge per clip with GCash, Maya or card — or keep them free.",
  },
];

const cardStyle = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-line)",
  borderRadius: "var(--radius-card)",
};

const IconChip = ({ icon: Icon }) => (
  <span
    className="inline-flex items-center justify-center w-9 h-9 shrink-0"
    style={{
      borderRadius: 10,
      border: "1px solid var(--color-line)",
      background: "var(--color-surface-sunken)",
      color: "var(--color-text-dark)",
    }}
  >
    <Icon className="w-4.5 h-4.5" />
  </span>
);

const SectionTitle = ({ eyebrow, title }) => (
  <div className="mb-6">
    <div
      className="flex items-center gap-2 mb-2"
      style={{
        fontSize: 11.5,
        fontWeight: 600,
        letterSpacing: ".06em",
        textTransform: "uppercase",
        color: "var(--color-text-muted)",
      }}
    >
      {/* Accent tick — the same marker SectionLabel uses */}
      <span
        aria-hidden="true"
        style={{
          width: 3,
          height: 12,
          borderRadius: 2,
          background: "var(--color-secondary-color)",
        }}
      />
      {eyebrow}
    </div>
    <h2
      className="m-0 font-semibold"
      style={{
        fontSize: 24,
        letterSpacing: "-.4px",
        color: "var(--color-text-dark)",
      }}
    >
      {title}
    </h2>
  </div>
);

/**
 * Public home page. Explains Dyna Cam to players and venues and links staff to
 * the Admin portal. The developer component gallery lives at `/components`
 * (`pages/ComponentGallery/`).
 */
const LandingPage = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen" style={{ background: "var(--color-canvas)" }}>
      {/* Top bar */}
      <div
        className="px-4 sm:px-6 py-3"
        style={{ borderBottom: "1px solid var(--color-line)" }}
      >
        <div className="mx-auto max-w-6xl flex items-center justify-between gap-3">
          <span
            className="font-semibold"
            style={{ fontSize: 15, color: "var(--color-text-dark)" }}
          >
            {APP_NAME}
          </span>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button variant="outline" onClick={() => navigate("/admin")}>
              Staff sign in
            </Button>
          </div>
        </div>
      </div>

      {/* Hero */}
      <header className="px-4 sm:px-6 pt-16 pb-14">
        <div className="mx-auto max-w-3xl text-center">
          <span
            className="inline-flex items-center gap-2 mb-5"
            style={{
              padding: "5px 11px",
              borderRadius: 999,
              border: "1px solid var(--color-line)",
              background: "var(--color-surface)",
              fontSize: 12,
              color: "var(--color-text-secondary)",
            }}
          >
            <span
              aria-hidden="true"
              className="w-1.5 h-1.5"
              style={{
                borderRadius: 999,
                background: "var(--color-secondary-color)",
              }}
            />
            Instant replay for pickleball courts
          </span>

          <h1
            className="m-0 font-semibold leading-tight"
            style={{
              fontSize: "clamp(32px, 6vw, 46px)",
              letterSpacing: "-1px",
              color: "var(--color-text-dark)",
            }}
          >
            Relive your best rallies.
          </h1>
          <p
            className="m-0 mt-4 mx-auto max-w-xl"
            style={{ fontSize: 16, color: "var(--color-text-secondary)" }}
          >
            A camera on every court is always recording. Scan the court&apos;s
            QR code and the last 60 seconds are saved to your phone — with
            nothing to install.
          </p>

          <div className="flex items-center justify-center gap-2.5 mt-8 flex-wrap">
            <Button size="lg" asChild>
              <a href="#how-it-works">
                See how it works
                <ArrowRight />
              </a>
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => navigate("/admin")}
            >
              Staff sign in
            </Button>
          </div>
        </div>
      </header>

      <main className="px-4 sm:px-6 pb-16">
        <div className="mx-auto max-w-6xl space-y-16">
          {/* How it works */}
          <section id="how-it-works" className="scroll-mt-6">
            <SectionTitle eyebrow="For players" title="How it works" />
            <ol className="m-0 p-0 list-none grid gap-4 md:grid-cols-3">
              {STEPS.map((step, i) => (
                <li key={step.title} className="p-5" style={cardStyle}>
                  <div className="flex items-center justify-between mb-4">
                    <IconChip icon={step.icon} />
                    <span
                      className="font-mono"
                      style={{ fontSize: 12, color: "var(--color-text-muted)" }}
                    >
                      0{i + 1}
                    </span>
                  </div>
                  <h3
                    className="m-0 font-semibold"
                    style={{ fontSize: 15.5, color: "var(--color-text-dark)" }}
                  >
                    {step.title}
                  </h3>
                  <p
                    className="m-0 mt-1.5"
                    style={{
                      fontSize: 13.5,
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    {step.body}
                  </p>
                </li>
              ))}
            </ol>
          </section>

          {/* For venues */}
          <section>
            <SectionTitle eyebrow="For venues" title="Built for your courts" />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map((f) => (
                <div key={f.title} className="p-5" style={cardStyle}>
                  <IconChip icon={f.icon} />
                  <h3
                    className="m-0 mt-4 font-semibold"
                    style={{ fontSize: 15, color: "var(--color-text-dark)" }}
                  >
                    {f.title}
                  </h3>
                  <p
                    className="m-0 mt-1.5"
                    style={{
                      fontSize: 13.5,
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    {f.body}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* Privacy */}
          <section
            className="p-5 flex items-start gap-3"
            style={{ ...cardStyle, background: "var(--color-surface-sunken)" }}
          >
            <ShieldCheck
              className="w-5 h-5 shrink-0 mt-0.5"
              style={{ color: "var(--color-text-muted)" }}
            />
            <p
              className="m-0"
              style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}
            >
              Courts are recorded continuously, but only the moments players
              choose to save are kept. Everything else is overwritten within
              minutes, and saved clips expire after the venue&apos;s retention
              period.
            </p>
          </section>
        </div>
      </main>

      <footer
        className="px-4 sm:px-6 py-8"
        style={{ borderTop: "1px solid var(--color-line)" }}
      >
        <div
          className="mx-auto max-w-6xl flex items-center justify-between gap-4 flex-wrap"
          style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}
        >
          <span>
            © {new Date().getFullYear()} {APP_NAME}
          </span>
          <button
            type="button"
            onClick={() => navigate("/admin")}
            className="bg-transparent border-0 p-0 cursor-pointer"
            style={{ fontSize: 12.5, color: "var(--color-link)" }}
          >
            Staff sign in
          </button>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
