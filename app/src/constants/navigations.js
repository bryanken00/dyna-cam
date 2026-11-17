/**
 * SCREEN_NAVIGATION
 *
 * Every route name in one place. Screens navigate with these constants, never
 * with string literals — a typo in a literal fails silently at runtime, a typo
 * here fails loudly as `undefined`.
 *
 * Group related routes into nested objects as the app grows, e.g.
 *
 *   export const SCREEN_NAVIGATION = {
 *     Home: "Home",
 *     Login: "Login",
 *     Account: {
 *       Profile: "Profile",
 *       ChangePassword: "ChangePassword",
 *     },
 *   };
 *
 * Access:
 *   SCREEN_NAVIGATION.Home
 *   SCREEN_NAVIGATION.Account.Profile
 */
export const SCREEN_NAVIGATION = {
  Home: "Home",
  Login: "Login",

  // The signed-in user's own account.
  Account: {
    ChangePassword: "ChangePassword",
  },

  // Modules reached from the Menu tab, not from the tab bar itself.
  // Keep the tab bar for top-level destinations only. Detail screens are
  // pushed from their module's list and take the record's ID as a param.
  Modules: {
    Courts: "Courts",
    CourtDetail: "CourtDetail", // { courtId, courtName? }
    Clips: "Clips", // { venueId?, courtId? } — opens pre-filtered
    ClipDetail: "ClipDetail", // { clipId }
    Sessions: "Sessions", // { bookCourtId? } — opens the booking form
    SessionDetail: "SessionDetail", // { sessionId }
    TakePayment: "TakePayment", // { payCode? } — looks it up at once
    RecorderBoxes: "RecorderBoxes",
  },
};
