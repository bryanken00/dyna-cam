#!/usr/bin/env bash
#
# update-ip.sh — point every .env URL at this machine's current LAN IP.
#
#   ./update-ip.sh                  # detect the IP (Windows Git Bash, macOS, Linux)
#   ./update-ip.sh 192.168.0.100    # or give it
#
# Rewrites back/.env, front/.env, app/.env and edge/.env the same way run.sh /
# run-mac.sh do before starting: every http(s)://<private IPv4> and
# http(s)://localhost (or 127.0.0.1) in a value becomes http(s)://<ip>. Kept as
# they are:
#   • GOOGLE_REDIRECT_URI — Google accepts localhost there, never a private IP
#   • ALLOWED_ORIGINS' localhost entries — the IP ones are added beside them
#   • plain host names (DB_HOST=localhost, RATE_LIMIT_REDIS_HOST)
#   • public addresses, 0.0.0.0, comments; line endings
# Prints what changed, never the values.
#
# ⚠️ Each app reads its .env only when it starts — restart the API, the web app,
#    the recorder box and Expo afterwards (or just use run.bat / run.sh).

set -u

cd "$(dirname "$0")" || exit 1

# This machine's LAN IPv4. Empty when offline.
lan_ip() {
  case "$(uname -s)" in
    MINGW* | MSYS* | CYGWIN*)
      # The adapter that is up and has a default gateway (Wi-Fi or Ethernet)
      powershell.exe -NoProfile -Command \
        "(Get-NetIPConfiguration | Where-Object { \$_.IPv4DefaultGateway -ne \$null -and \$_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1).IPv4Address.IPAddress" \
        2>/dev/null | tr -d '\r' | head -n 1
      ;;
    Darwin)
      local ifc ip
      ifc="$(route -n get default 2>/dev/null | awk '/interface:/ { print $2; exit }')"
      for i in $ifc en0 en1; do
        ip="$(ipconfig getifaddr "$i" 2>/dev/null)"
        [ -n "$ip" ] && { echo "$ip"; return 0; }
      done
      ;;
    *)
      # Linux: the source address of the default route
      ip -4 route get 1.1.1.1 2>/dev/null |
        awk '{ for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit } }'
      ;;
  esac
}

IP="${1:-$(lan_ip)}"

if [ -z "$IP" ]; then
  echo "!! no LAN IP found (offline?) — give it: ./update-ip.sh 192.168.0.100" >&2
  exit 1
fi
if ! [[ "$IP" =~ ^(10\.[0-9]+\.[0-9]+\.[0-9]+|192\.168\.[0-9]+\.[0-9]+|172\.(1[6-9]|2[0-9]|3[01])\.[0-9]+\.[0-9]+)$ ]]; then
  echo "!! $IP is not a private LAN IPv4 (10.x, 172.16–31.x, 192.168.x)" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "!! node is not on PATH" >&2
  exit 1
fi

echo "LAN IP $IP"

node - "$IP" back/.env front/.env app/.env edge/.env <<'NODE'
const fs = require("fs");
const [ip, ...files] = process.argv.slice(2);
const PRIVATE = /^(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;
const URL_IP = /(https?:\/\/)(\d{1,3}(?:\.\d{1,3}){3})(?=[:/,"'\s]|$)/g;
const URL_LOCAL = /(https?:\/\/)(localhost|127\.0\.0\.1)(?=[:/,"'\s]|$)/g;
const IS_LOCAL = /^(https?:\/\/)(localhost|127\.0\.0\.1)(?=[:/]|$)/;
const KEEP_LOCAL = new Set(["GOOGLE_REDIRECT_URI"]);
let any = false;
for (const file of files) {
  if (!fs.existsSync(file)) {
    console.log(`·  ${file}: not found, skipped`);
    continue;
  }
  const text = fs.readFileSync(file, "utf8");
  const changed = new Set();
  const olds = new Set();
  const out = text.split("\n").map((raw) => {
    // Windows files end lines in \r\n: match without the \r, put it back after
    const cr = raw.endsWith("\r") ? "\r" : "";
    const line = cr ? raw.slice(0, -1) : raw;
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!m) return raw;
    const key = m[1];
    let value = m[2].replace(URL_IP, (all, scheme, host) => {
      if (host === ip || !PRIVATE.test(host)) return all;
      changed.add(key);
      olds.add(host);
      return scheme + ip;
    });
    if (key === "ALLOWED_ORIGINS") {
      // Add the IP twin of each localhost origin that lacks one
      const quote = /^(['"]).*\1$/.test(value) ? value[0] : "";
      const list = (quote ? value.slice(1, -1) : value).split(",").map((o) => o.trim()).filter(Boolean);
      const twins = list
        .filter((o) => IS_LOCAL.test(o))
        .map((o) => o.replace(IS_LOCAL, `$1${ip}`))
        .filter((o) => !list.includes(o));
      if (twins.length) {
        value = quote + [...list, ...new Set(twins)].join(",") + quote;
        changed.add(key);
        olds.add("localhost");
      }
    } else if (!KEEP_LOCAL.has(key)) {
      value = value.replace(URL_LOCAL, (all, scheme, host) => {
        changed.add(key);
        olds.add(host);
        return scheme + ip;
      });
    }
    return value === m[2] ? raw : line.slice(0, line.length - m[2].length) + value + cr;
  });
  if (changed.size) {
    fs.writeFileSync(file, out.join("\n"));
    any = true;
    console.log(`🔁 ${file}: ${[...olds].join(", ")} → ${ip} (${[...changed].join(", ")})`);
  } else {
    console.log(`✓  ${file}: already ${ip}`);
  }
}
if (any) console.log("\nRestart the API, web app, recorder box and Expo so they read the new IP.");
NODE
