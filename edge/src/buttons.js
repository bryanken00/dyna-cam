import crypto from "node:crypto";
import http from "node:http";

/**
 * LAN listener for physical court buttons (Shelly Button 1 "actions" send a
 * GET; an ESP32 can POST):
 *
 *   GET|POST /press/:buttonCode[?key=BUTTON_KEY]  → 202 {"ok":true}
 *   GET /health                                   → 200 {"ok":true}
 *
 * The press time is taken the moment the request arrives and the button gets
 * its answer straight away — it never waits on the internet. The relay to the
 * API (with retry) happens in jobs.js.
 */

export const BUTTON_CODE = /^[A-Za-z0-9_-]{3,32}$/;
export const DEBOUNCE_MS = 3000;

/**
 * Route a request. → { route: "press", code, key } | { route: "health" } |
 * { status, error } for anything else (pure — unit-tested).
 */
export function routeRequest(method, rawUrl) {
  let url;
  try {
    url = new URL(rawUrl, "http://box");
  } catch (_err) {
    return { status: 400, error: "Bad request" };
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length === 1 && parts[0] === "health" && method === "GET") return { route: "health" };
  if (parts[0] !== "press" || parts.length !== 2) return { status: 404, error: "Not found" };
  if (method !== "GET" && method !== "POST") return { status: 405, error: "Use GET or POST" };
  let code;
  try {
    code = decodeURIComponent(parts[1]);
  } catch (_err) {
    code = "";
  }
  if (!BUTTON_CODE.test(code)) {
    return { status: 400, error: "Button code must be 3–32 letters, digits, - or _" };
  }
  return { route: "press", code, key: url.searchParams.get("key") };
}

/** Constant-time key check. No key configured → every request passes. */
export function keyMatches(expected, given) {
  if (!expected) return true;
  if (typeof given !== "string") return false;
  const a = crypto.createHash("sha256").update(expected).digest();
  const b = crypto.createHash("sha256").update(given).digest();
  return crypto.timingSafeEqual(a, b);
}

/** The same code again within `windowMs` of its last accepted press is a bounce. */
export class Debouncer {
  constructor(windowMs = DEBOUNCE_MS) {
    this.windowMs = windowMs;
    this.last = new Map();
  }

  accept(code, nowMs) {
    const last = this.last.get(code);
    if (last !== undefined && nowMs - last < this.windowMs) return false;
    this.last.set(code, nowMs);
    // Forget old codes so the map cannot grow without bound
    if (this.last.size > 500) {
      for (const [key, at] of this.last) if (nowMs - at >= this.windowMs) this.last.delete(key);
    }
    return true;
  }
}

/**
 * The HTTP server. `onPress({ buttonCode, pressedAtMs })` is called after the
 * 202 is sent; errors in it are logged, never shown to the button.
 */
export function createButtonServer({ key = "", onPress, log, now = () => Date.now() }) {
  const debouncer = new Debouncer();
  const server = http.createServer((req, res) => {
    const receivedAt = now(); // the press time — before anything else
    const reply = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json", Connection: "close" });
      res.end(JSON.stringify(body));
    };
    req.resume(); // an ESP32 POST body is ignored

    const route = routeRequest(req.method, req.url);
    if (route.route === "health") return reply(200, { ok: true });
    if (!route.route) return reply(route.status, { ok: false, error: route.error });
    if (!keyMatches(key, route.key)) {
      log.warn(`button press with a missing or wrong key from ${req.socket.remoteAddress}`);
      return reply(401, { ok: false, error: "Wrong or missing key" });
    }
    if (!debouncer.accept(route.code, receivedAt)) {
      log.info(`button ${route.code}: pressed again within ${DEBOUNCE_MS / 1000}s — ignored`);
      return reply(202, { ok: true, duplicate: true });
    }
    reply(202, { ok: true });
    log.info(`button ${route.code} pressed (${req.socket.remoteAddress})`);
    Promise.resolve()
      .then(() => onPress({ buttonCode: route.code, pressedAtMs: receivedAt }))
      .catch((err) => log.error(`button ${route.code}: could not queue the press`, err));
    return undefined;
  });
  // A button only ever sends a tiny request
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 1000;
  return server;
}

/** Start listening; resolves the server, or null (logged) if the port is taken. */
export function startButtonServer({ host, port, ...options }) {
  const server = createButtonServer(options);
  return new Promise((resolve) => {
    server.once("error", (err) => {
      options.log.error(
        `button listener could not start on ${host}:${port} — buttons are off`,
        err
      );
      resolve(null);
    });
    server.listen(port, host, () => {
      const keyNote = options.key ? "key required" : "no BUTTON_KEY — anyone on the LAN can press";
      options.log.info(
        `button listener on http://${host}:${server.address().port}/press/<code> (${keyNote})`
      );
      resolve(server);
    });
  });
}
