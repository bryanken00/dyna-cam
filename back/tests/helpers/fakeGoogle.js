// A fake Google for the API tests (CR-001, CR-040): OAuth token / revoke and
// Drive v3 files, folders, permissions and resumable uploads, so nothing leaves
// the machine. Point GOOGLE_* URLs at its server (see google-drive.test.js).

import http from "node:http";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

/**
 * A fake Google. An authorization code is "<email>" (Drive ticked) or
 * "nodrive:<email>" (Drive left unticked). Files a sign-in made are visible
 * only to that same account (Drive's `drive.file` scope).
 */
export const fakeGoogle = () => {
  const state = {
    refresh: new Map(), // refresh token → email
    revoked: new Set(),
    files: new Map(), // id → { name, parents, owner, mimeType, size, shared }
    sessions: new Map(), // upload session → { meta, owner, received }
    fail: null, // { status, body } to answer the next upload start with
    trashFail: null, // CR-017: { status, body } to answer the next "move to trash" with
    count: 0,
  };
  const next = (prefix) => `${prefix}-${++state.count}`;
  const json = (res, status, body, headers = {}) => {
    res.writeHead(status, { "Content-Type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };
  const ownerOf = (req) => {
    const token = (req.headers.authorization || "").replace(/^Bearer /, "");
    const refresh = token.replace(/^access:/, "");
    if (!token.startsWith("access:") || state.revoked.has(refresh)) return null;
    return state.refresh.get(refresh) || null;
  };
  const visible = (id, owner) => {
    const file = state.files.get(id);
    return file && file.owner === owner ? file : null;
  };
  const read = (req) =>
    new Promise((resolve) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks)));
    });

  /** Google's OAuth endpoints. @returns {boolean} handled */
  const oauth = (req, res, url, body) => {
    const params = new URLSearchParams(body.toString());
    if (req.method !== "POST") return false;
    if (url.pathname === "/token" && params.get("grant_type") === "authorization_code") {
      const code = params.get("code");
      const email = code.replace(/^nodrive:/, "");
      const refresh = next("refresh");
      state.refresh.set(refresh, email);
      const idToken = ["x", Buffer.from(JSON.stringify({ email })).toString("base64url"), "sig"];
      json(res, 200, {
        access_token: `access:${refresh}`,
        refresh_token: refresh,
        id_token: idToken.join("."),
        scope: code.startsWith("nodrive:") ? "openid email" : `openid email ${DRIVE_SCOPE}`,
      });
      return true;
    }
    if (url.pathname === "/token") {
      const refresh = params.get("refresh_token");
      if (!state.refresh.has(refresh) || state.revoked.has(refresh)) {
        json(res, 400, { error: "invalid_grant" });
      } else {
        json(res, 200, { access_token: `access:${refresh}` });
      }
      return true;
    }
    if (url.pathname === "/revoke") {
      const email = state.refresh.get(params.get("token"));
      // Revoking ends the account's whole grant to the app
      for (const [refresh, owner] of state.refresh) {
        if (owner === email) state.revoked.add(refresh);
      }
      json(res, 200, {});
      return true;
    }
    return false;
  };

  /** Drive v3 files, folders and permissions. @returns {boolean} handled */
  const files = (req, res, url, body, owner) => {
    if (req.method === "POST" && url.pathname === "/drive/files") {
      const meta = JSON.parse(body.toString());
      const parent = meta.parents?.[0];
      if (parent && !visible(parent, owner)) {
        json(res, 404, { error: { message: "nf" } });
        return true;
      }
      const id = next("folder");
      state.files.set(id, { ...meta, owner, shared: false });
      json(res, 200, { id, webViewLink: `https://drive.test/folders/${id}` });
      return true;
    }
    const match = url.pathname.match(/^\/drive\/files\/([^/]+)(\/permissions)?$/);
    if (!match) return false;
    const file = visible(match[1], owner);
    if (!file) {
      json(res, 404, { error: { message: "File not found" } });
    } else if (match[2] && req.method === "POST") {
      const permission = JSON.parse(body.toString());
      file.shared = permission.type === "anyone" && permission.role === "reader";
      json(res, 200, { id: "anyoneWithLink" });
    } else if (req.method === "PATCH") {
      // CR-017: { trashed: true } moves it to the owner's trash
      if (state.trashFail) {
        json(res, state.trashFail.status, state.trashFail.body);
        state.trashFail = null;
      } else {
        file.trashed = Boolean(JSON.parse(body.toString()).trashed);
        json(res, 200, { id: match[1], trashed: file.trashed });
      }
    } else {
      // CR-040: what the API reads back before believing a box's upload
      json(res, 200, {
        id: match[1],
        trashed: Boolean(file.trashed),
        size: file.size === undefined ? undefined : String(file.size),
        parents: file.parents || [],
        webViewLink: `https://drive.test/file/${match[1]}`,
      });
    }
    return true;
  };

  /** Drive's resumable uploads: start a session, then PUT the bytes. @returns {boolean} handled */
  const uploads = (req, res, url, body, owner) => {
    if (req.method === "POST" && url.pathname === "/upload/files") {
      const meta = JSON.parse(body.toString());
      if (state.fail) {
        json(res, state.fail.status, state.fail.body);
        state.fail = null;
      } else if (!visible(meta.parents?.[0], owner)) {
        json(res, 404, { error: { message: "nf" } });
      } else {
        const session = next("upload");
        const size = Number(req.headers["x-upload-content-length"]);
        state.sessions.set(session, { meta, owner, size, received: 0 });
        res.writeHead(200, { Location: `http://${req.headers.host}/session/${session}` });
        res.end();
      }
      return true;
    }
    return false;
  };

  /**
   * PUT bytes to a session — no token needed (the session address is the
   * credential; CR-040's box has none). An empty PUT with a Content-Range of
   * "bytes, star, slash, size" asks how much Google has. @returns {boolean} handled
   */
  const sessionPut = (req, res, url, body) => {
    const match = url.pathname.match(/^\/session\/(.+)$/);
    if (req.method !== "PUT" || !match) return false;
    const upload = state.sessions.get(match[1]);
    if (!upload) {
      json(res, 404, {});
      return true;
    }
    const range = String(req.headers["content-range"] || "");
    const at = range.match(/^bytes (\d+)-\d+\//);
    if (at && Number(at[1]) !== upload.received) {
      // Not where Google is: say where (like Google's 308 with Range)
      res.writeHead(308, upload.received ? { Range: `bytes=0-${upload.received - 1}` } : {});
      res.end();
      return true;
    }
    upload.received += body.length;
    if (upload.received < upload.size) {
      res.writeHead(308, upload.received ? { Range: `bytes=0-${upload.received - 1}` } : {});
      res.end();
      return true;
    }
    const id = next("file");
    upload.fileId = id;
    state.files.set(id, {
      ...upload.meta,
      owner: upload.owner,
      size: upload.received,
      shared: false,
    });
    json(res, 200, { id, webViewLink: `https://drive.test/file/${id}` });
    return true;
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://fake");
    const body = await read(req);
    if (oauth(req, res, url, body)) return;
    if (sessionPut(req, res, url, body)) return;
    const owner = ownerOf(req);
    if (!owner) {
      json(res, 401, { error: { message: "Invalid Credentials" } });
      return;
    }
    if (files(req, res, url, body, owner) || uploads(req, res, url, body, owner)) return;
    json(res, 404, { error: { message: `fake: ${req.method} ${url.pathname}` } });
  });

  return { server, state };
};
