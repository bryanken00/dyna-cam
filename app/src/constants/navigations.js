/**
 * SCREEN_NAVIGATION
 *
 * Every route name in one place. Screens navigate with these constants, never
 * with string literals — a typo in a literal fails silently at runtime, a typo
 * here fails loudly as `undefined`.
 *
 * PLAN-009: one DGSports app, two modes (Navigation/index.js swaps them):
 *
 *   Welcome — first launch: "I'm a player" / "Set up a courtside device"
 *
 *   Courtside device (PLAN-002 Phase E, Navigation/DeviceNavigator.js) —
 *   switched by the navigator from the pairing and the session's state:
 *     Pair    — not paired: enter the 6-digit key from the session
 *     Session — paired, the session not over: live video, QR, timer, Stop
 *     Ended   — the session is over: QR, saving progress, Done, unpair countdown
 *
 *   Player (Navigation/PlayerNavigator.js):
 *     SignIn          — signed out: Continue with Google
 *     CompleteProfile — first sign-in: names and phone, before booking
 *     PlayerTabs      — the tabs: Home · Book · OpenPlays · Communities · Me
 *     EditProfile     — pushed from Me
 */
export const SCREEN_NAVIGATION = {
  Welcome: "Welcome",

  Pair: "Pair",
  Session: "Session",
  Ended: "Ended",

  SignIn: "SignIn",
  CompleteProfile: "CompleteProfile",
  PlayerTabs: "PlayerTabs",
  Home: "Home",
  Book: "Book",
  OpenPlays: "OpenPlays",
  Communities: "Communities",
  Me: "Me",
  EditProfile: "EditProfile",
};
