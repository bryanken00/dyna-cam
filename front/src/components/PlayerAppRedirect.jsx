import { useEffect } from "react";
import { useLocation } from "react-router";

import { ComponentLoader } from "./LoadingFallback";

/**
 * PLAN-009: the player app (web-app/) has the booking pages, My games and the
 * profile. Once VITE_PLAYER_APP_URL is set, those paths here send the browser
 * there — same path and query, so old links in emails, on signs and in
 * bookmarks keep working. Unset, the page renders here as before.
 */
const PLAYER_APP_URL = (import.meta.env.VITE_PLAYER_APP_URL || "").replace(/\/+$/, "");

const PlayerAppRedirect = ({ children }) => {
  const { pathname, search, hash } = useLocation();

  useEffect(() => {
    if (PLAYER_APP_URL) window.location.replace(`${PLAYER_APP_URL}${pathname}${search}${hash}`);
  }, [pathname, search, hash]);

  return PLAYER_APP_URL ? <ComponentLoader /> : children;
};

export default PlayerAppRedirect;
