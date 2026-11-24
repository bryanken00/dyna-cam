// CR-036: the opening splash, once per browser tab. index.html draws it (the
// DGPlay logo bouncing in on its blue) from the first paint and hides it before
// paint when this tab has already seen it; this lets the bounce finish, holds
// the logo a moment, fades the splash out and removes it.

const SEEN_KEY = "dg-splash-seen";
const SEEN_CLASS = "dg-splash-seen";
const SHOW_MS = 1600; // the 1.1 s bounce, then the logo held still
const REDUCED_MOTION_MS = 700; // no bounce: a still logo, briefly
const FADE_MS = 320; // matches the transition in index.html

const markSeen = () => {
  try {
    sessionStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Storage blocked: the splash simply shows again next load
  }
};

export const startSplash = () => {
  const splash = document.getElementById("dg-splash");
  if (!splash) return;
  if (document.documentElement.classList.contains(SEEN_CLASS)) {
    splash.remove();
    return;
  }

  // Keep the page behind still and out of reach while the splash is up
  const root = document.documentElement;
  const app = document.getElementById("root");
  const overflow = root.style.overflow;
  root.style.overflow = "hidden";
  if (app) app.inert = true;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  setTimeout(
    () => {
      root.style.overflow = overflow;
      if (app) app.inert = false;
      splash.classList.add("dg-out");
      markSeen();
      setTimeout(() => splash.remove(), reduced ? 0 : FADE_MS + 40);
    },
    reduced ? REDUCED_MOTION_MS : SHOW_MS
  );
};
