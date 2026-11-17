/**
 * SCREEN_NAVIGATION
 *
 * Every route name in one place. Screens navigate with these constants, never
 * with string literals — a typo in a literal fails silently at runtime, a typo
 * here fails loudly as `undefined`.
 *
 * The app is a session device (PLAN-002 Phase E): three screens, each in its
 * own navigator that Navigation/index.js swaps on the pairing and the
 * session's state — nothing navigates between them by hand.
 *
 *   Pair    — not paired: enter the 6-digit key from the session
 *   Session — paired, the session not over: live video, QR, timer, Stop
 *   Ended   — the session is over: QR, saving progress, Done, unpair countdown
 */
export const SCREEN_NAVIGATION = {
  Pair: "Pair",
  Session: "Session",
  Ended: "Ended",
};
