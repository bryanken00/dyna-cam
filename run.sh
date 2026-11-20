#!/usr/bin/env bash
#
# run.sh — run the API and the frontend from one terminal, in Git Bash on Windows.
#
#   ./run.sh                     # both
#   ./run.sh back                # just the API (or: front)
#   ./run.sh back app            # the API + the Expo dev server for the mobile app (opt-in)
#   ./run.sh back front edge     # + the recorder box (opt-in; needs ffmpeg and a paired box in edge/.env)
#   ./run.sh stop                # free the dev ports if anything was left behind
#
# Output is prefixed per app. Ctrl+C stops all of them. Before starting, the
# LAN IP in the .env files' URLs is updated to this machine's current one
# (NO_IP_UPDATE=1 skips that).
#
# 📌 The Windows sibling of ./run-mac.sh — same flags, same ports, same colours.
#    What differs is how ports and processes are found, because Git Bash pids
#    are MSYS pids, not Windows ones, and Windows has no POSIX process groups:
#
#      lsof -iTCP:<port>   → netstat -ano
#      ps / kill -<pgid>   → tasklist / taskkill //T (kills the whole tree)
#      $! (an MSYS pid)    → /proc/<pid>/winpid (the Windows pid taskkill needs)
#
# ⚠️ Ctrl+C in Git Bash does not reliably reach node, so stopping is done by the
#    trap below with taskkill — killing only `npm` would orphan the vite or
#    nodemon child that actually holds the port. `stop` is the backstop for
#    anything left behind (a closed window, a crash).

set -u

cd "$(dirname "$0")" || exit 1

case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*) ;;
  Darwin)
    echo "This is the Windows script — on macOS use ./run-mac.sh" >&2
    exit 1
    ;;
  *)
    echo "This is the Windows (Git Bash) script — elsewhere use ./run-mac.sh" >&2
    exit 1
    ;;
esac

# The API listens on PORT from back/.env (4021 if unset); Vite on 4020.
BACK_PORT="$(sed -n 's/^PORT=\([0-9][0-9]*\).*/\1/p' back/.env 2>/dev/null | tr -d '\r' | tail -n 1)"
BACK_PORT="${BACK_PORT:-4021}"

# The recorder box (edge/) has no web page; it serves the live view on LIVE_PORT
# from edge/.env (8090 if unset) and court buttons on BUTTON_PORT (8089). The
# live port is the one checked and freed below — the button port when the live
# view is turned off (LIVE_PORT empty or 0).
EDGE_PORT="$(sed -n 's/^LIVE_PORT=\([0-9]*\).*/\1/p' edge/.env 2>/dev/null | tr -d '\r' | tail -n 1)"
if grep -q '^LIVE_PORT=' edge/.env 2>/dev/null && { [ -z "$EDGE_PORT" ] || [ "$EDGE_PORT" = "0" ]; }; then
  EDGE_PORT="$(sed -n 's/^BUTTON_PORT=\([0-9][0-9]*\).*/\1/p' edge/.env 2>/dev/null | tr -d '\r' | tail -n 1)"
  EDGE_PORT="${EDGE_PORT:-8089}"
fi
EDGE_PORT="${EDGE_PORT:-8090}"

# name : port : ANSI colour
# `app` is the Expo dev server (Metro, 8081). It is opt-in — never started by
# the no-argument default — because Expo is happiest in its own terminal, where
# its QR code and key shortcuts work. Through this script you get the URL only.
# `edge` is the recorder box agent (`node --watch`). Also opt-in: it records the
# cameras in edge/.env with ffmpeg, which a front-end-only session doesn't want.
ALL=(
  "back:$BACK_PORT:36"
  "front:4020:34"
  "app:8081:35"
  "edge:$EDGE_PORT:33"
)
DEFAULT=(back front)

PIDFILE=".run.pid"

# ── LAN IP ───────────────────────────────────────────────────────────────────
# This machine's LAN IPv4: the adapter that is up and has a default gateway
# (Wi-Fi or Ethernet), asked of PowerShell. Empty when offline.
lan_ip() {
  powershell.exe -NoProfile -Command \
    "(Get-NetIPConfiguration | Where-Object { \$_.IPv4DefaultGateway -ne \$null -and \$_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1).IPv4Address.IPAddress" \
    2>/dev/null | tr -d '\r' | head -n 1
}

# Rewrites every http(s)://<private LAN IPv4> in the .env files' values to the
# current IP. localhost, 0.0.0.0 and public addresses are left alone; comments
# are skipped; line endings are kept. Prints what changed, never the values.
update_env_ips() {
  local ip="$1"
  shift
  node - "$ip" "$@" <<'NODE'
const fs = require("fs");
const [ip, ...files] = process.argv.slice(2);
const PRIVATE = /^(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;
const URL_IP = /(https?:\/\/)(\d{1,3}(?:\.\d{1,3}){3})(?=[:/,"'\s]|$)/g;
for (const file of files) {
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, "utf8");
  const changed = new Set();
  const olds = new Set();
  const out = text.split("\n").map((raw) => {
    // Windows files end lines in \r\n: match without the \r, put it back after
    const cr = raw.endsWith("\r") ? "\r" : "";
    const line = cr ? raw.slice(0, -1) : raw;
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!m) return raw;
    const value = m[2].replace(URL_IP, (all, scheme, host) => {
      if (host === ip || !PRIVATE.test(host)) return all;
      changed.add(m[1]);
      olds.add(host);
      return scheme + ip;
    });
    return value === m[2] ? raw : line.slice(0, line.length - m[2].length) + value + cr;
  });
  if (changed.size) {
    fs.writeFileSync(file, out.join("\n"));
    console.log(`🔁 ${file}: ${[...olds].join(", ")} → ${ip} (${[...changed].join(", ")})`);
  }
}
NODE
}

# The .env files whose URLs point at this machine on the LAN (phones, the
# recorder box and the web app reach the API by IP, not localhost).
ENV_FILES=(back/.env front/.env app/.env edge/.env)

# ── process helpers (all pids here are Windows pids) ─────────────────────────

# Windows pids listening on a TCP port (IPv4 and IPv6), one per line, deduped.
listeners_on() {
  netstat -ano 2>/dev/null | tr -d '\r' |
    awk -v suffix=":$1" '$1 == "TCP" && $4 == "LISTENING" &&
      substr($2, length($2) - length(suffix) + 1) == suffix { print $5 }' |
    sort -u
}

# The image name for a Windows pid ("node.exe"). Empty if the pid is gone.
image_of() {
  tasklist //FI "PID eq $1" //FO CSV //NH 2>/dev/null | tr -d '\r' |
    awk -F'","' '/\.exe/ { gsub(/"/, "", $1); print $1; exit }'
}

# The Windows pid behind an MSYS pid (e.g. $! or $$). Empty if it is gone.
winpid_of() {
  cat "/proc/$1/winpid" 2>/dev/null
}

# Kill a Windows pid and everything it started.
kill_tree() {
  taskkill //PID "$1" //T //F >/dev/null 2>&1
}

# ── ./run.sh stop ────────────────────────────────────────────────────────────
# Frees the dev ports, but only when the listener is actually node — a busy
# port can legitimately belong to something else, and killing that would be
# worse than the collision.
if [ "${1:-}" = "stop" ]; then
  killed=0

  # The runner first, so nodemon is not left waiting for file changes and npm
  # does not keep the original window looking hung.
  #
  # ⚠️ Only if that pid is still a bash — a stale pid file can name a pid that
  #    Windows has since reused for an unrelated program.
  if [ -f "$PIDFILE" ]; then
    runpid="$(tr -d '\r' < "$PIDFILE" 2>/dev/null)"
    mypid="$(winpid_of $$)"
    if [ -n "$runpid" ] && [ "$runpid" != "$mypid" ] && [ "$(image_of "$runpid")" = "bash.exe" ]; then
      kill_tree "$runpid"
      echo "stopped run.sh (pid $runpid)"
      killed=$((killed + 1))
    fi
    rm -f "$PIDFILE"
  fi

  for entry in "${ALL[@]}"; do
    name="${entry%%:*}"
    rest="${entry#*:}"
    port="${rest%%:*}"

    for pid in $(listeners_on "$port"); do
      image="$(image_of "$pid")"
      case "$image" in
        node.exe)
          kill_tree "$pid"
          echo "stopped $name (port $port, pid $pid)"
          killed=$((killed + 1))
          ;;
        "")
          # Gone between netstat and tasklist. Nothing to do.
          ;;
        *)
          echo "!! port $port is held by $image (pid $pid), not node — left alone" >&2
          ;;
      esac
    done
  done

  [ "$killed" -gt 0 ] || echo "nothing to stop — dev ports are already free"
  exit 0
fi

# ── pick the apps ────────────────────────────────────────────────────────────
selected=()
if [ $# -eq 0 ]; then
  set -- "${DEFAULT[@]}"
fi
if [ $# -gt 0 ]; then
  for want in "$@"; do
    hit=""
    for entry in "${ALL[@]}"; do
      [ "${entry%%:*}" = "$want" ] && hit="$entry"
    done
    if [ -z "$hit" ]; then
      echo "Unknown app: $want" >&2
      echo "Choose from: back front app edge  (or: stop)" >&2
      exit 1
    fi
    selected+=("$hit")
  done
fi

# ── pre-flight ───────────────────────────────────────────────────────────────
# No node_modules or no .env means the app cannot start (or, for the frontend,
# starts with no API URL and every call fails) — catch it here, not in devtools.
fail=0
for entry in "${selected[@]}"; do
  name="${entry%%:*}"
  [ -d "$name/node_modules" ] || {
    echo "!! $name has no node_modules — run ./setup.sh" >&2
    fail=1
  }
  [ -f "$name/.env" ] || {
    echo "!! $name has no .env — run ./setup.sh" >&2
    fail=1
  }
done
[ "$fail" -eq 0 ] || exit 1

# A busy port either fails the API or makes Vite quietly move to another port.
# Say so up front, and say WHAT is holding it.
for entry in "${selected[@]}"; do
  name="${entry%%:*}"
  rest="${entry#*:}"
  port="${rest%%:*}"

  for pid in $(listeners_on "$port"); do
    echo "!! port $port ($name) is already in use by $(image_of "$pid") (pid $pid)" >&2
    echo "   run ./run.sh stop, or close the other process" >&2
    fail=1
  done
done
[ "$fail" -eq 0 ] || exit 1

# ── shutdown ─────────────────────────────────────────────────────────────────
CHILDREN="" # Windows pids of the apps
stopping=0

stop() {
  [ "$stopping" -eq 0 ] || return
  stopping=1
  trap - INT TERM EXIT

  # Job notices ("Terminated") for the killed apps read like a crash at the end
  # of a clean Ctrl+C; our own messages are on stdout and are unaffected.
  exec 2>/dev/null

  printf '\n\033[1;31mStopping…\033[0m\n'

  for pid in $CHILDREN; do
    kill_tree "$pid"
  done

  # Backstop: anything still holding a dev port goes now. Clear the pid file
  # first so the `stop` path does not try to kill the shell already running it.
  rm -f "$PIDFILE"
  "$0" stop >/dev/null 2>&1

  wait 2>/dev/null
  printf '\033[1;31mStopped.\033[0m\n'
  exit 0
}
trap stop INT TERM EXIT

# ── keep the LAN IP current ──────────────────────────────────────────────────
# A new Wi-Fi (or a new DHCP lease) gives this machine another IP, and every
# URL below that still names the old one stops working — the app can't reach
# the API, the box can't upload, the web app's calls fail. Before anything
# starts (each app reads its .env at start), point them at the current IP.
# Skip with NO_IP_UPDATE=1 (e.g. when an .env points at another machine).
if [ "${NO_IP_UPDATE:-}" != "1" ]; then
  CURRENT_IP="$(lan_ip)"
  if [ -n "$CURRENT_IP" ]; then
    update_env_ips "$CURRENT_IP" "${ENV_FILES[@]}"
    printf 'LAN IP %s  (phones and the recorder box reach the API at http://%s:%s)\n' \
      "$CURRENT_IP" "$CURRENT_IP" "$BACK_PORT"
  else
    echo "!! no LAN IP found (offline?) — .env URLs left as they are" >&2
  fi
fi

# ── start ────────────────────────────────────────────────────────────────────
winpid_of $$ > "$PIDFILE"

# Prefix every line with the app name, in its colour.
prefix() {
  local colour="$1" name="$2" line
  while IFS= read -r line; do
    printf '\033[1;%sm%-6s\033[0m | %s\n' "$colour" "$name" "${line%$'\r'}"
  done
}

printf '\n'
for entry in "${selected[@]}"; do
  name="${entry%%:*}"
  rest="${entry#*:}"
  port="${rest%%:*}"
  colour="${rest##*:}"

  # ⚠️ Process substitution, not a pipeline. In a pipeline `$!` is the LAST
  #    command, so we would record the pid of the prefixer and leave npm
  #    unkillable. This way $! is the app itself.
  ( cd "$name" && exec npm run dev ) > >(prefix "$colour" "$name") 2>&1 &
  CHILDREN="$CHILDREN $(winpid_of $!)"

  printf '\033[1;%sm%-6s\033[0m http://localhost:%s\n' "$colour" "$name" "$port"
done

printf '\nCtrl+C stops everything.  If anything is left behind: ./run.sh stop\n\n'
wait
