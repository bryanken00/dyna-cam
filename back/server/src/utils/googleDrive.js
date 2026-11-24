import { decryptSecret, encryptSecret } from "./crypto/secretBox.js";
import { appUrl } from "./clips.js";

/**
 * Google Drive for courts (CR-001) — plain REST over `fetch`, no Google SDK.
 *
 * Staff connect one Google account per court (OAuth "web server" flow); the
 * API keeps its refresh token (encrypted). CR-040: the API never uploads a
 * file — it opens a resumable upload session (openUploadSession) that the
 * venue's recorder box sends the video to, then reads the file back (getFile)
 * and shares it by link.
 *
 *   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET   the OAuth client (type "Web")
 *   GOOGLE_REDIRECT_URI                       registered in Google Cloud; points
 *                                             at GET /api/v1/oauth/google/callback
 *
 * Without all three, Drive is "not set up": the court page says so and
 * nothing uploads. Scope `drive.file`: the API sees only the files and
 * folders it created, never the rest of the account's Drive.
 *
 * The base URLs can be overridden (GOOGLE_AUTH_URL, GOOGLE_TOKEN_URL,
 * GOOGLE_REVOKE_URL, GOOGLE_DRIVE_API_URL, GOOGLE_DRIVE_UPLOAD_URL) — the
 * tests point them at a fake Google.
 */

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const SCOPES = ["openid", "email", DRIVE_SCOPE];
const FOLDER_MIME = "application/vnd.google-apps.folder";

/** How long the consent screen's `state` stays valid. */
const STATE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 2 * 60 * 1000;

const urls = () => ({
  auth: process.env.GOOGLE_AUTH_URL || "https://accounts.google.com/o/oauth2/v2/auth",
  token: process.env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token",
  revoke: process.env.GOOGLE_REVOKE_URL || "https://oauth2.googleapis.com/revoke",
  api: (process.env.GOOGLE_DRIVE_API_URL || "https://www.googleapis.com/drive/v3").replace(
    /\/+$/,
    ""
  ),
  upload: (
    process.env.GOOGLE_DRIVE_UPLOAD_URL || "https://www.googleapis.com/upload/drive/v3"
  ).replace(/\/+$/, ""),
});

const client = () => ({
  id: process.env.GOOGLE_CLIENT_ID || "",
  secret: process.env.GOOGLE_CLIENT_SECRET || "",
  redirectUri: process.env.GOOGLE_REDIRECT_URI || "",
});

/** True when the server has an OAuth client to connect courts with. */
export const driveConfigured = () => {
  const { id, secret, redirectUri } = client();
  return Boolean(id && secret && redirectUri);
};

/** Google refused the stored sign-in: the court has to be reconnected. */
export class DriveAuthError extends Error {}

/** A file or folder the request named is gone (or not visible to this sign-in). */
export class DriveNotFoundError extends Error {}

/** Anything else Google answered with an error. `retryable` says whether to try again later. */
export class DriveError extends Error {
  constructor(message, { status = null, retryable = true } = {}) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

// ── consent screen ───────────────────────────────────────────────────────────

/**
 * The `state` for Google's consent screen: which court, who asked, and until
 * when — encrypted and authenticated (AES-GCM), so the callback can trust it
 * without a login. It is the callback's only credential.
 */
export const signDriveState = ({ courtId, venueId, accountId }) =>
  encryptSecret(
    JSON.stringify({ c: courtId, v: venueId, a: accountId, e: Date.now() + STATE_TTL_MS })
  );

/** @returns {{ courtId, venueId, accountId } | null} null when forged, garbled or expired */
export const readDriveState = (state) => {
  if (typeof state !== "string" || state.length > 1024) return null;
  const plain = decryptSecret(state);
  if (!plain) return null;
  try {
    const { c, v, a, e } = JSON.parse(plain);
    if (!c || !v || !a || typeof e !== "number" || e < Date.now()) return null;
    return { courtId: c, venueId: v, accountId: a };
  } catch {
    return null;
  }
};

/** Google's consent screen for connecting a court. */
export const consentUrl = (state) => {
  const { id, redirectUri } = client();
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    // offline + consent: Google returns a refresh token every time, also when
    // the account was connected before (to this or another court)
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "true",
    state,
  });
  return `${urls().auth}?${params}`;
};

/** Where the browser lands after the consent screen: the court's setup page. */
export const courtSetupUrl = ({ venueId, courtId } = {}, query = {}) => {
  const base =
    venueId && courtId
      ? `${appUrl()}/admin/setup/venues/${encodeURIComponent(venueId)}/courts/${encodeURIComponent(courtId)}`
      : `${appUrl()}/admin/setup/venues`;
  const params = new URLSearchParams(query).toString();
  return params ? `${base}?${params}` : base;
};

// ── tokens ───────────────────────────────────────────────────────────────────

const request = async (url, init = {}) => {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), ...init });
  } catch (err) {
    throw new DriveError(
      `Could not reach Google (${err.name === "TimeoutError" ? "timed out" : err.message})`
    );
  }
};

const readJson = async (res) => {
  try {
    return await res.json();
  } catch {
    return {};
  }
};

/** The email in an ID token received straight from Google's token endpoint (TLS). */
const emailFromIdToken = (idToken) => {
  try {
    const payload = JSON.parse(Buffer.from(String(idToken).split(".")[1], "base64url").toString());
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
};

/**
 * Trade the consent screen's code for a refresh token.
 * @returns {Promise<{ refreshToken: string, email: string|null }>}
 * @throws {DriveError} with a message for staff when Google refused, or when
 *   the Drive permission was left unticked on the consent screen
 */
export const exchangeCode = async (code) => {
  const { id, secret, redirectUri } = client();
  const res = await request(urls().token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: id,
      client_secret: secret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const body = await readJson(res);
  if (!res.ok) {
    throw new DriveError("Google did not accept the sign-in. Try connecting again.", {
      status: res.status,
      retryable: false,
    });
  }
  const granted = String(body.scope || "").split(/\s+/);
  if (!granted.includes(DRIVE_SCOPE)) {
    throw new DriveError(
      "DGSports needs permission to add files to Google Drive. Connect again and tick it.",
      { retryable: false }
    );
  }
  if (!body.refresh_token) {
    throw new DriveError("Google did not grant offline access. Try connecting again.", {
      retryable: false,
    });
  }
  return { refreshToken: body.refresh_token, email: emailFromIdToken(body.id_token) };
};

/**
 * A short-lived access token for a stored refresh token.
 * @throws {DriveAuthError} when the sign-in was revoked or expired
 */
export const accessToken = async (refreshToken) => {
  const { id, secret } = client();
  const res = await request(urls().token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: id,
      client_secret: secret,
      grant_type: "refresh_token",
    }),
  });
  const body = await readJson(res);
  if (res.ok && body.access_token) return body.access_token;
  if (body.error === "invalid_grant" || res.status === 401) {
    throw new DriveAuthError("Google removed DGSports' access to this account. Reconnect it.");
  }
  throw new DriveError(`Google sign-in failed (${body.error || res.status})`, {
    status: res.status,
  });
};

/**
 * Revoke a refresh token at Google. Best effort: never throws. Revoking ends
 * the whole grant of that Google account to DGSports, so callers only revoke
 * when no other court is connected to the same account.
 */
export const revokeToken = async (refreshToken) => {
  if (!refreshToken) return;
  try {
    await request(urls().revoke, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }),
    });
  } catch {
    // The token stays valid at Google until it is unused for 6 months; we no longer hold it
  }
};

// ── Drive files ──────────────────────────────────────────────────────────────

/** Turn a failed Drive response into the right error. */
const driveFailure = async (res, what) => {
  const body = await readJson(res);
  const reason = body?.error?.errors?.[0]?.reason || body?.error?.status || "";
  const message = body?.error?.message || `HTTP ${res.status}`;
  if (res.status === 401) {
    return new DriveAuthError("Google removed DGSports' access to this account. Reconnect it.");
  }
  if (res.status === 404) return new DriveNotFoundError(`${what}: not found`);
  if (reason === "storageQuotaExceeded") {
    return new DriveError("The Google Drive is full", { status: res.status });
  }
  // 403 rate limits, 429 and 5xx are worth retrying; other 4xx are not
  const retryable =
    res.status >= 500 ||
    res.status === 429 ||
    (res.status === 403 && /rateLimit|RateLimit/.test(reason));
  return new DriveError(`${what}: ${message}`.slice(0, 250), { status: res.status, retryable });
};

const auth = (token) => ({ Authorization: `Bearer ${token}` });

/**
 * Create a folder.
 * @returns {Promise<{ id: string, webViewLink: string|null }>}
 */
export const createFolder = async (token, { name, parentId = null }) => {
  const res = await request(`${urls().api}/files?fields=id,webViewLink`, {
    method: "POST",
    headers: { ...auth(token), "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME,
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });
  if (!res.ok) throw await driveFailure(res, "Creating the folder");
  const body = await readJson(res);
  return { id: body.id, webViewLink: body.webViewLink || null };
};

/** True when a folder this sign-in made still exists and is not in the bin. */
export const folderUsable = async (token, folderId) => {
  const res = await request(
    `${urls().api}/files/${encodeURIComponent(folderId)}?fields=id,trashed`,
    { headers: auth(token) }
  );
  if (res.status === 404) return false;
  if (!res.ok) throw await driveFailure(res, "Checking the folder");
  const body = await readJson(res);
  return !body.trashed;
};

/** Let anyone with the link view a file or folder (players have no Google sign-in). */
export const shareWithLink = async (token, fileId) => {
  const res = await request(
    `${urls().api}/files/${encodeURIComponent(fileId)}/permissions?fields=id`,
    {
      method: "POST",
      headers: { ...auth(token), "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ role: "reader", type: "anyone", allowFileDiscovery: false }),
    }
  );
  if (!res.ok) throw await driveFailure(res, "Sharing the file");
};

/**
 * CR-017: move a file or folder this sign-in made to the Drive's trash
 * (Google empties it after 30 days; until then the owner can restore it, and
 * its shared link stops working).
 * @returns {Promise<boolean>} false when it was already gone (or isn't this sign-in's)
 */
export const trashFile = async (token, fileId) => {
  const res = await request(
    `${urls().api}/files/${encodeURIComponent(fileId)}?fields=id,trashed`,
    {
      method: "PATCH",
      headers: { ...auth(token), "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ trashed: true }),
    }
  );
  if (res.status === 404) return false;
  if (!res.ok) throw await driveFailure(res, "Moving it to the Drive's trash");
  return true;
};

/**
 * Open a resumable upload session for one file in a folder. Google answers with
 * the session's address: whoever holds it can send that one file's bytes (no
 * token needed), for about a week. CR-040: the API opens it with the court's
 * sign-in and hands the address to the venue's recorder box, which sends the
 * file to Google itself — the bytes never pass through the API.
 *
 * @returns {Promise<string>} the session URI
 * @throws {DriveNotFoundError} when the folder is gone
 */
export const openUploadSession = async (token, { name, parentId, sizeBytes, mimeType = "video/mp4" }) => {
  const start = await request(`${urls().upload}/files?uploadType=resumable&fields=id,webViewLink`, {
    method: "POST",
    headers: {
      ...auth(token),
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": mimeType,
      "X-Upload-Content-Length": String(sizeBytes),
    },
    body: JSON.stringify({ name, parents: [parentId], mimeType }),
  });
  if (!start.ok) throw await driveFailure(start, "Starting the upload");
  const session = start.headers.get("location");
  if (!session) throw new DriveError("Google did not start the upload session");
  return session;
};

/**
 * CR-040: a file as Drive has it — what the API checks before believing a
 * recorder box's "it's uploaded".
 * @returns {Promise<{ id, size: number, parents: string[], trashed: boolean, webViewLink }|null>}
 *   null when it doesn't exist (or isn't this sign-in's)
 */
export const getFile = async (token, fileId) => {
  const res = await request(
    `${urls().api}/files/${encodeURIComponent(fileId)}?fields=id,size,parents,trashed,webViewLink`,
    { headers: auth(token) }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw await driveFailure(res, "Checking the file");
  const body = await readJson(res);
  return {
    id: body.id,
    size: Number(body.size || 0),
    parents: body.parents || [],
    trashed: Boolean(body.trashed),
    webViewLink: body.webViewLink || null,
  };
};

/** The address players open for a file DGSports shared. */
export const fileViewUrl = (fileId, webViewLink) =>
  webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;

/** The address players open for a shared folder. */
export const folderViewUrl = (folderId, webViewLink) =>
  webViewLink || `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`;
