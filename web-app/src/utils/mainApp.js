/**
 * PLAN-009: pages that stay on the main DGSports web app (front/) — a game's
 * page with its live view and saves, clips, streams, the TV board. The player
 * app links there by full URL. VITE_MAIN_APP_URL is that app's origin; empty
 * means the same origin (both apps behind one domain).
 */
const MAIN_APP_URL = (import.meta.env.VITE_MAIN_APP_URL || "").replace(/\/+$/, "");

/** A game's page on the main app. */
export const gamePageUrl = (shareToken) => `${MAIN_APP_URL}/session/${encodeURIComponent(shareToken)}`;
