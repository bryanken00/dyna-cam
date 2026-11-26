import crypto from "node:crypto";
import { decryptSecret, encryptSecret } from "./crypto/secretBox.js";
import { appUrl } from "./clips.js";

/**
 * PLAN-006: players sign in with Google (OpenID Connect "web server" flow,
 * plain REST over `fetch`, no Google SDK). The same OAuth client as Drive
 * (CR-001), with its own redirect:
 *
 *   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET   the OAuth client (type "Web")
 *   GOOGLE_LOGIN_REDIRECT_URI                 registered in Google Cloud; points at
 *                                             GET /api/v1/auth/google/callback
 *
 * Without all three, player sign-in is off — and so is booking online.
 *
 * The ID token comes straight from Google's token endpoint over TLS, so (per
 * OpenID Connect Core 3.1.3.7) its claims are checked — issuer, audience,
 * expiry, nonce, verified email — without fetching Google's signing keys.
 * GOOGLE_AUTH_URL / GOOGLE_TOKEN_URL can point at a fake Google (tests).
 */

const SCOPES = ["openid", "email", "profile"];
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const STATE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30 * 1000;

const urls = () => ({
  auth: process.env.GOOGLE_AUTH_URL || "https://accounts.google.com/o/oauth2/v2/auth",
  token: process.env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token",
});

const client = () => ({
  id: process.env.GOOGLE_CLIENT_ID || "",
  secret: process.env.GOOGLE_CLIENT_SECRET || "",
  redirectUri: process.env.GOOGLE_LOGIN_REDIRECT_URI || "",
});

/** True when the server can sign players in (and so take online bookings). */
export const playerSignInConfigured = () => {
  const { id, secret, redirectUri } = client();
  return Boolean(id && secret && redirectUri);
};

// ── where the player goes back to ───────────────────────────────────────────

/** Player pages a sign-in may return to: /book…, /booking…, /me/games (path + a plain query). */
const RETURN_ROOTS = ["/book", "/booking", "/me/games"];
const PATH_CHARS = /^[A-Za-z0-9_/-]+$/;
const QUERY_CHARS = /^[A-Za-z0-9_\-=&%.:+]*$/;
export const DEFAULT_RETURN_PATH = "/me/games";

/** The return path if it's one of the player pages, else the game log. */
export const safeReturnPath = (value) => {
  const full = typeof value === "string" ? value.trim() : "";
  if (!full || full.length > 300) return DEFAULT_RETURN_PATH;
  const [path, query = "", extra] = full.split("?");
  const ok =
    extra === undefined &&
    PATH_CHARS.test(path) &&
    !path.includes("//") &&
    RETURN_ROOTS.some((root) => path === root || path.startsWith(`${root}/`)) &&
    QUERY_CHARS.test(query);
  return ok ? full : DEFAULT_RETURN_PATH;
};

/** The front page that finishes a sign-in: `/signed-in?code=…&next=…` or `?error=…&next=…`. */
export const signedInUrl = (query) => `${appUrl()}/signed-in?${new URLSearchParams(query)}`;

// ── state ───────────────────────────────────────────────────────────────────

/**
 * The `state` for Google's screen: where to go back to and the nonce the ID
 * token must carry — encrypted and authenticated, valid 10 minutes. It's the
 * callback's only link to the start.
 */
export const signLoginState = ({ returnPath, nonce }) =>
  encryptSecret(JSON.stringify({ k: "player", r: returnPath, n: nonce, e: Date.now() + STATE_TTL_MS }));

/** @returns {{ returnPath: string, nonce: string } | null} null when forged, garbled or expired */
export const readLoginState = (state) => {
  if (typeof state !== "string" || state.length > 2048) return null;
  const plain = decryptSecret(state);
  if (!plain) return null;
  try {
    const { k, r, n, e } = JSON.parse(plain);
    if (k !== "player" || !n || typeof e !== "number" || e < Date.now()) return null;
    return { returnPath: safeReturnPath(r), nonce: n };
  } catch {
    return null;
  }
};

export const newNonce = () => crypto.randomBytes(16).toString("base64url");

/** Google's sign-in screen. */
export const signInUrl = ({ state, nonce }) => {
  const { id, redirectUri } = client();
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    prompt: "select_account",
    nonce,
    state,
  });
  return `${urls().auth}?${params}`;
};

// ── Google's answer ─────────────────────────────────────────────────────────

/** Google said no, or answered something unusable. `reason` goes to the sign-in page. */
export class GoogleSignInError extends Error {
  constructor(message, reason = "failed") {
    super(message);
    this.reason = reason;
  }
}

const decodeClaims = (idToken) => {
  try {
    return JSON.parse(Buffer.from(String(idToken).split(".")[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
};

/**
 * Check an ID token's claims (pure, exported for tests).
 * @returns {{ sub, email, name, givenName, familyName, photoUrl }}
 * @throws {GoogleSignInError}
 */
export const checkIdToken = (claims, { clientId, nonce, nowSeconds = Math.floor(Date.now() / 1000) }) => {
  if (!claims || typeof claims !== "object") throw new GoogleSignInError("No ID token from Google");
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!ISSUERS.has(claims.iss)) throw new GoogleSignInError("ID token from the wrong issuer");
  if (!clientId || !audience.includes(clientId)) {
    throw new GoogleSignInError("ID token for another app");
  }
  if (typeof claims.exp !== "number" || claims.exp < nowSeconds - 60) {
    throw new GoogleSignInError("ID token expired");
  }
  if (!nonce || claims.nonce !== nonce) throw new GoogleSignInError("ID token nonce mismatch");
  if (typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 64) {
    throw new GoogleSignInError("ID token without a user");
  }
  const email = typeof claims.email === "string" ? claims.email.trim() : "";
  if (!email || email.length > 255 || claims.email_verified !== true) {
    throw new GoogleSignInError("Google account email isn't verified", "refused");
  }
  const name =
    (typeof claims.name === "string" && claims.name.trim()) || email.split("@")[0] || "Player";
  const photo = typeof claims.picture === "string" ? claims.picture : "";
  const part = (value) => (typeof value === "string" ? value.trim().slice(0, 50) : "") || null;
  return {
    sub: claims.sub,
    email,
    name: name.slice(0, 100),
    // Pre-fill the profile the player completes on their first sign-in
    givenName: part(claims.given_name),
    familyName: part(claims.family_name),
    photoUrl: /^https:\/\//.test(photo) && photo.length <= 500 ? photo : null,
  };
};

/**
 * Trade the code from Google's screen for the player's Google identity.
 * @returns {Promise<{ sub, email, name, photoUrl }>}
 * @throws {GoogleSignInError}
 */
export const exchangeLoginCode = async ({ code, nonce }) => {
  const { id, secret, redirectUri } = client();
  let res;
  try {
    res = await fetch(urls().token, {
      method: "POST",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: id,
        client_secret: secret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
  } catch (err) {
    throw new GoogleSignInError(`Could not reach Google (${err.message})`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.id_token) {
    throw new GoogleSignInError(`Google refused the sign-in (${res.status})`);
  }
  return checkIdToken(decodeClaims(body.id_token), { clientId: id, nonce });
};
