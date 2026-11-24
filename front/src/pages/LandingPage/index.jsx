import { Link, useNavigate } from "react-router";
import {
  ArrowRight,
  Bell,
  CalendarCheck,
  Camera,
  CloudUpload,
  HandCoins,
  MonitorPlay,
  QrCode,
  Radio,
  RadioTower,
  ShieldCheck,
  Smartphone,
  Tv,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import ThemeToggle from "@/components/ThemeToggle";
import DGMark from "@/components/brand/DGMark";
import Wordmark from "@/components/brand/Wordmark";
import { APP_NAME } from "@/components/brand/appName";
import HeroCourt, { ReplayBar } from "@/components/brand/HeroCourt";

/**
 * A player's game, in the order it happens: book, check in at the court's QR with the booking
 * code (CR-034), play (CR-041: Resume after ending early), then the Drive link (CR-040).
 */
const STEPS = [
  {
    icon: CalendarCheck,
    title: "Book your court",
    body: "Pick a venue, a court and a time. Pay online with GCash, Maya or a card, or at the desk. You get a booking code.",
  },
  {
    icon: QrCode,
    title: "Check in at the court",
    body: "When you arrive, scan the QR sign by your court and enter your booking code. The cameras roll for your booked time. Nothing to install.",
  },
  {
    icon: Smartphone,
    title: "Play, watch, save",
    body: "Your game's page shows the court live and saves your best rallies as you play. Ended too soon? Resume for the rest of your time.",
  },
  {
    icon: Video,
    title: "Get the whole game",
    body: "After the game, the whole game, one video per camera, goes to Google Drive. Watch or download it there, no Google account needed.",
  },
];

/** What players can do during their game, all from their game's page. */
const DURING_GAME = [
  {
    icon: MonitorPlay,
    title: "Watch it live",
    body: "On the venue Wi-Fi, your game's page shows the court live. Missed a point? Rewind up to 50 seconds.",
  },
  {
    icon: Camera,
    title: "Save a great rally",
    body: "Tap Save a part of your game and set its start and end. It's its own video in a few minutes, up to 5 per game.",
  },
  {
    icon: Radio,
    title: "Go live",
    body: "Add your Facebook or YouTube stream key on your game's page and stream your game: Cam 1, Cam 2 or both.",
  },
];

/** What a venue gets — only what the product does today. */
const VENUE_FEATURES = [
  {
    icon: CalendarCheck,
    title: "Online booking and payment",
    body: "Players book from your booking link and pay with GCash, Maya or a card, or at the desk. They can cancel or move before your cut-off.",
  },
  {
    icon: QrCode,
    title: "Check-in at the court",
    body: "Players scan the court's QR sign and enter their booking code, and recording starts by itself. No front-desk work.",
  },
  {
    icon: Camera,
    title: "Two cameras per court",
    body: "One behind each baseline, so every shot is in the frame. Each game is one video per camera.",
  },
  {
    icon: CloudUpload,
    title: "Videos straight to your Google Drive",
    body: "Your recorder box sends each game to the court's Google Drive. Players get a Drive link; videos never pass through our servers.",
  },
  {
    icon: Tv,
    title: "Court board on your TV",
    body: "Show today's courts on a TV at your venue: what's playing, what's booked and what's free. No names or codes on screen.",
  },
  {
    icon: HandCoins,
    title: "Payments in one place",
    body: "See every booking and payment, record desk payments, and refund cancelled online bookings from the web.",
  },
  {
    icon: RadioTower,
    title: "Stream your courts",
    body: "Send a court live to YouTube or Facebook for leagues, ladders and tournaments.",
  },
  {
    icon: Bell,
    title: "Told when something stops",
    body: "If a camera or recorder box goes down, your team gets a message on Discord, and another when it's back.",
  },
];

const container = "mx-auto max-w-6xl px-4 sm:px-6";

const ON_NAVY = "var(--color-brand-on-court)";

/** Small uppercase label above a section headline (the design's eyebrow). */
const Eyebrow = ({ children, onNavy = false }) => (
  <p
    className="m-0 uppercase font-semibold"
    style={{
      fontSize: 11.5,
      letterSpacing: "0.14em",
      color: onNavy ? "var(--color-brand-ball)" : "var(--color-link)",
    }}
  >
    {children}
  </p>
);

const headlineStyle = (onNavy) => ({
  fontSize: "clamp(32px, 4.6vw, 48px)",
  lineHeight: 1.06,
  fontWeight: 500,
  letterSpacing: "-1.8px",
  color: onNavy ? ON_NAVY : "var(--color-text-dark)",
});

const bodyStyle = { fontSize: 15, lineHeight: 1.65, color: "var(--color-text-secondary)" };

/** Section head: eyebrow + headline on the left, a short paragraph on the right. */
const SectionHead = ({ eyebrow, title, body, onNavy = false, children }) => (
  <div className="grid gap-6 lg:grid-cols-2 lg:gap-16 items-end">
    <div>
      <Eyebrow onNavy={onNavy}>{eyebrow}</Eyebrow>
      <h2 className="m-0 mt-3" style={headlineStyle(onNavy)}>
        {title}
      </h2>
    </div>
    <div className="lg:pb-2">
      <p
        className="m-0 max-w-md"
        style={{ ...bodyStyle, color: onNavy ? "rgb(255 255 255 / 0.72)" : bodyStyle.color }}
      >
        {body}
      </p>
      {children}
    </div>
  </div>
);

/** Blue icon on a pale blue tile (follows the theme through `--color-link`). */
const IconTile = ({ icon: Icon }) => (
  <span
    className="inline-flex items-center justify-center shrink-0"
    style={{
      width: 34,
      height: 34,
      borderRadius: 8,
      color: "var(--color-link)",
      background: "color-mix(in srgb, var(--color-link) 12%, transparent)",
    }}
  >
    <Icon className="w-4 h-4" strokeWidth={1.9} />
  </span>
);

/** A row of items split by hairlines; `numbered` adds the 01 / 02 / 03 … rule. */
const ItemRow = ({ items, numbered = false }) => (
  <ol
    className={`m-0 mt-12 p-0 list-none grid ${
      items.length === 4 ? "md:grid-cols-2 lg:grid-cols-4 md:gap-y-10" : "md:grid-cols-3"
    }`}
  >
    {items.map((item, i) => (
      <li
        key={item.title}
        className={`py-6 md:py-0 ${
          i > 0
            ? items.length === 4
              ? `border-t md:border-t-0 ${i % 2 ? "md:pl-8 md:border-l" : "lg:pl-8"} lg:border-l`
              : "md:pl-8 border-t md:border-t-0 md:border-l"
            : ""
        } ${i < items.length - 1 ? "md:pr-8" : ""}`}
        style={{ borderColor: "var(--color-line)" }}
      >
        {numbered && (
          <div className="hidden md:flex items-center gap-3 mb-8">
            <span
              className="font-semibold"
              style={{ fontSize: 11.5, letterSpacing: "0.08em", color: "var(--color-link)" }}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="flex-1 h-px" style={{ background: "var(--color-line)" }} />
          </div>
        )}
        <IconTile icon={item.icon} />
        <h3
          className="m-0 mt-5"
          style={{ fontSize: 17, fontWeight: 500, color: "var(--color-text-dark)" }}
        >
          {numbered && <span className="md:hidden">{i + 1}. </span>}
          {item.title}
        </h3>
        <p className="m-0 mt-2 max-w-xs" style={{ ...bodyStyle, fontSize: 14 }}>
          {item.body}
        </p>
      </li>
    ))}
  </ol>
);

const NavLink = ({ href, children }) => (
  <a href={href} className="court-nav-link hidden md:inline px-2.5 py-1.5">
    {children}
  </a>
);

/**
 * Public home page (CR-011, after the "Improve UI and UX" design): a navy hero
 * with the brand court on a tilted card, how a game is recorded (book → check in
 * at the court with the booking code → play, watch, save → Google Drive), what
 * players can do during it, a navy call-out for venues, what venues get, and the
 * privacy note. CR-030: Book a court in the top bar and the hero opens /book.
 * CR-042: the words follow today's flow (CR-034 check-in, CR-040 Drive only).
 */
const LandingPage = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen" style={{ background: "var(--color-canvas)" }}>
      {/* Navy hero (top bar + hero), the same in both themes */}
      <div className="on-court overflow-hidden" style={{ background: "var(--color-brand-court)" }}>
        <div style={{ borderBottom: "1px solid rgb(255 255 255 / 0.1)" }}>
          <div className={`${container} py-3 flex items-center justify-between gap-3`}>
            <a
              href="#top"
              className="inline-flex items-center gap-2.5"
              style={{ textDecoration: "none" }}
            >
              <DGMark size={30} tile={false} />
              <Wordmark size={18} onBrand />
            </a>
            <nav className="flex items-center gap-1">
              <NavLink href="#how-it-works">How it works</NavLink>
              <NavLink href="#during-your-game">During your game</NavLink>
              <NavLink href="#venues">For venues</NavLink>
              {/* CR-030: the way in for players — on phones too */}
              <Button size="sm" className="btn-on-navy ml-1.5" asChild>
                <Link to="/book">Book a court</Link>
              </Button>
              <span className="ml-1.5">
                <ThemeToggle />
              </span>
            </nav>
          </div>
        </div>

        <header id="top" className={`${container} pt-14 sm:pt-20 pb-20 sm:pb-24`}>
          <div className="grid gap-12 lg:gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-center">
            <div>
              <Eyebrow onNavy>Instant replay for pickleball</Eyebrow>
              <h1
                className="m-0 mt-4"
                style={{
                  fontSize: "clamp(42px, 7vw, 68px)",
                  lineHeight: 1.0,
                  fontWeight: 500,
                  letterSpacing: "-2.4px",
                  color: ON_NAVY,
                }}
              >
                Great rally?
                <br />
                Keep it.
              </h1>
              <p
                className="m-0 mt-6 max-w-md"
                style={{ ...bodyStyle, fontSize: 16.5, color: "rgb(255 255 255 / 0.74)" }}
              >
                Book a court, scan its code and enter your booking code — the whole game records.
                Watch it live, save your best rallies, and get every minute from Google Drive on
                your phone. Nothing to install.
              </p>
              <div className="flex items-center gap-2.5 mt-9 flex-wrap">
                <Button size="lg" className="btn-on-navy" asChild>
                  <Link to="/book">
                    <CalendarCheck />
                    Book a court
                  </Link>
                </Button>
                <Button size="lg" variant="outline" className="btn-on-court" asChild>
                  <a href="#how-it-works">See how it works</a>
                </Button>
              </div>
            </div>

            <figure className="hero-card m-0 p-5 sm:p-7">
              <HeroCourt />
              <div className="mt-6">
                <ReplayBar />
              </div>
            </figure>
          </div>
        </header>
      </div>

      <main>
        {/* How it works */}
        <section id="how-it-works" className="scroll-mt-4">
          <div className={`${container} py-20 sm:py-24`}>
            <SectionHead
              eyebrow="Four steps. That's it."
              title="Your whole game, without stopping play."
              body="Book online, check in at the court, and play. DGSports records in the background so you can stay focused on the game, not the camera."
            />
            <ItemRow items={STEPS} numbered />
          </div>
        </section>

        {/* During your game */}
        <section
          id="during-your-game"
          className="scroll-mt-4"
          style={{ background: "var(--color-surface)", borderTop: "1px solid var(--color-line)" }}
        >
          <div className={`${container} py-20 sm:py-24`}>
            <SectionHead
              eyebrow="During your game"
              title="Great shot? Keep it on the spot."
              body="The cameras roll from the moment you check in, so the best moments are never missed. Everything is on your game's page."
            />
            <ItemRow items={DURING_GAME} />
          </div>
        </section>

        {/* Navy call-out */}
        <section className="on-court" style={{ background: "var(--color-brand-court)" }}>
          <div className={`${container} py-20 sm:py-24`}>
            <SectionHead
              onNavy
              eyebrow="Built for busy courts"
              title="Give every player an instant highlight reel."
              body="Simple for players. Easy for staff. A feature people remember, and come back for."
            >
              <Button size="lg" className="btn-on-navy mt-7" asChild>
                <a href="#venues">
                  Explore venue tools
                  <ArrowRight />
                </a>
              </Button>
            </SectionHead>
          </div>
        </section>

        {/* For venues */}
        <section id="venues" className="scroll-mt-4">
          <div className={`${container} py-20 sm:py-24`}>
            <SectionHead
              eyebrow="For venues"
              title="Everything your front desk needs."
              body="A small recorder box at your venue runs the cameras and sends every game to your Google Drive. Your staff manage bookings, courts, games and payments from the web."
            />
            <ul className="m-0 mt-12 p-0 list-none grid sm:grid-cols-2 lg:grid-cols-3 gap-x-10">
              {VENUE_FEATURES.map((feature) => (
                <li
                  key={feature.title}
                  className="flex gap-4 py-6"
                  style={{ borderTop: "1px solid var(--color-line)" }}
                >
                  <IconTile icon={feature.icon} />
                  <div>
                    <h3
                      className="m-0"
                      style={{ fontSize: 16, fontWeight: 500, color: "var(--color-text-dark)" }}
                    >
                      {feature.title}
                    </h3>
                    <p className="m-0 mt-1.5" style={{ ...bodyStyle, fontSize: 14 }}>
                      {feature.body}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Privacy */}
        <section style={{ borderTop: "1px solid var(--color-line)" }}>
          <div className={`${container} py-10 flex items-start gap-3`}>
            <ShieldCheck
              className="w-5 h-5 shrink-0 mt-0.5"
              strokeWidth={1.8}
              style={{ color: "var(--color-link)" }}
            />
            <p className="m-0 max-w-3xl" style={{ ...bodyStyle, fontSize: 14 }}>
              Courts are recorded all the time, but only booked games and the parts players save
              are kept. Everything else is recorded over within minutes. Videos never pass through
              our servers: the venue&apos;s recorder box sends them straight to the court&apos;s
              Google Drive, and they are deleted 7 days after the game (unless the venue chooses
              otherwise).
            </p>
          </div>
        </section>
      </main>

      <footer style={{ background: "var(--color-brand-court)" }}>
        <div
          className={`${container} py-8 flex items-center justify-between gap-4 flex-wrap`}
          style={{ fontSize: 13, color: "rgb(255 255 255 / 0.7)" }}
        >
          <span className="inline-flex items-center gap-2">
            <DGMark size={20} tile={false} />© {new Date().getFullYear()} {APP_NAME}
          </span>
          <button
            type="button"
            onClick={() => navigate("/admin")}
            className="bg-transparent border-0 p-0 cursor-pointer"
            style={{ fontSize: 13, color: "var(--color-brand-ball)" }}
          >
            Staff sign in
          </button>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
