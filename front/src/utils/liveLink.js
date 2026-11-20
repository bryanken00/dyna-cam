/**
 * CR-025: helpers for the court's live link (the recorder box's signed HLS
 * URL, the same one the court device plays). ⚠️ The link carries a secret
 * `sig` — never log it or put it in an error report.
 */

/** The stream a link points to, without its signature: "http://box:8090/live/…/index.m3u8". */
export const liveIdentity = (url) => {
  const match = /^(https?:\/\/[^/?#]+)([^?#]*)/.exec(String(url ?? ""));
  return match ? `${match[1]}${match[2]}` : null;
};

/** When the link stops working, in epoch ms (its own `exp`, Unix seconds). null if unknown. */
export const liveExpiryMs = (url) => {
  const exp = /[?&]exp=(\d+)/.exec(String(url ?? ""))?.[1];
  return exp ? Number(exp) * 1000 : null;
};

/** The link for `camera` (1 or 2) on a two-camera court, else the court's only link. */
export const liveUrlFor = (live, camera) =>
  live?.cameras?.find((link) => link.camera === camera)?.hlsUrl ??
  live?.hlsUrl ??
  null;

/**
 * A plain-HTTP box link can't play on an HTTPS page (the browser blocks it as
 * mixed content) — the box needs its certificate (CERT_PATH) for that.
 */
export const blockedByPage = (url) =>
  window.location.protocol === "https:" && String(url).startsWith("http:");

/**
 * True only where hls.js can't run (no Media Source — older iPhones), so the
 * browser's own HLS is the one way to play. Not `canPlayType()` alone: Edge
 * and Chrome on Windows answer "maybe" for HLS and then fail the box's stream
 * (BUG-005), so hls.js goes first wherever it works.
 */
export const nativeHlsOnly = (video) =>
  !("MediaSource" in window) &&
  !("ManagedMediaSource" in window) &&
  Boolean(video.canPlayType("application/vnd.apple.mpegurl"));
