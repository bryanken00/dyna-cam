#!/usr/bin/env bash
#
# run-mac.sh — run the API and the frontend from one terminal, on macOS.
#
#   ./run-mac.sh                 # both
#   ./run-mac.sh back            # just the API (or: front)
#   ./run-mac.sh back app        # the API + the Expo dev server for the mobile app (opt-in)
#   ./run-mac.sh back front edge # + the recorder box (opt-in; needs ffmpeg and a paired box in edge/.env)
#   ./run-mac.sh stop            # free the dev ports if anything was left behind
#
# Output is prefixed per app. Ctrl+C stops all of them. Before starting, the
# LAN IP in the .env files' URLs is updated to this machine's current one
# (NO_IP_UPDATE=1 skips that).
#
# 📌 The macOS sibling of ./run.sh (Git Bash on Windows) — same flags, same
#    ports, same colours. What differs is how ports and processes are found:
#
#      netstat -ano        → lsof -nP -iTCP:<port> -sTCP:LISTEN
#      tasklist / taskkill → ps / kill
#      the MSYS→Windows pid mapping → not needed; these are real POSIX pids
#
# ✅ Ctrl+C really does reach node here, so the trap below is the normal path and
#    `stop` is only for orphans (a closed tab, a SIGKILL, a crash).
#
# Written for the bash macOS ships (3.2) — no associative arrays, no mapfile,
# no ${var,,}. It works on Homebrew bash 5 too, and on Linux with lsof installed.

set -u

cd "$(dirname "$0")" || exit 1

# The API listens on PORT from back/.env (4021 if unset); Vite on 4020.
BACK_PORT="$(sed -n 's/^PORT=\([0-9][0-9]*\).*/\1/p' back/.env 2>/dev/null | tail -n 1)"
BACK_PORT="${BACK_PORT:-4021}"

# The recorder box (edge/) has no web page; its one port is the live view on
# LIVE_PORT from edge/.env (8090 if unset) — the one checked and freed below.
# With the live view turned off (LIVE_PORT empty or 0) it listens on nothing,
# and 8090 is still the port named here (CR-044 removed the court-button port).
EDGE_PORT="$(sed -n 's/^LIVE_PORT=\([0-9]*\).*/\1/p' edge/.env 2>/dev/null | tail -n 1)"
[ "$EDGE_PORT" = "0" ] && EDGE_PORT=""
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

# Our own process group, so nothing below can ever signal the terminal we are
# running in. Every kill path checks against this.
MYPGID="$(ps -p $$ -o pgid= 2>/dev/null | tr -d ' ')"

# ── LAN IP ───────────────────────────────────────────────────────────────────
# This machine's LAN IPv4: the interface of the default route (Wi-Fi or
# Ethernet), else the first of en0 / en1. Empty when offline.
lan_ip() {
  local ifc ip
  ifc="$(route -n get default 2>/dev/null | awk '/interface:/ { print $2; exit }')"
  for i in $ifc en0 en1; do
    ip="$(ipconfig getifaddr "$i" 2>/dev/null)"
    [ -n "$ip" ] && { echo "$ip"; return 0; }
  done
  # Linux: the source address of the default route
  ip -4 route get 1.1.1.1 2>/dev/null | awk '{ for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit } }'
}

# Points the .env files' URLs at this machine's current LAN IP: every
# http(s)://<private IPv4> and http(s)://localhost (or 127.0.0.1) in a value
# becomes http(s)://<ip>. Kept as they are:
#   • GOOGLE_REDIRECT_URI, GOOGLE_LOGIN_REDIRECT_URI — Google accepts localhost there, never a private IP
#   • ALLOWED_ORIGINS' localhost entries — the IP ones are added beside them, so
#     the web app works opened either way
#   • plain host names (DB_HOST=localhost, RATE_LIMIT_REDIS_HOST) — MySQL and
#     Redis usually listen on this machine's loopback only
#   • public addresses, 0.0.0.0, comments; line endings
# Prints what changed, never the values.
update_env_ips() {
  local ip="$1"
  shift
  node - "$ip" "$@" <<'NODE'
const fs = require("fs");
const [ip, ...files] = process.argv.slice(2);
const PRIVATE = /^(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;
const URL_IP = /(https?:\/\/)(\d{1,3}(?:\.\d{1,3}){3})(?=[:/,"'\s]|$)/g;
const URL_LOCAL = /(https?:\/\/)(localhost|127\.0\.0\.1)(?=[:/,"'\s]|$)/g;
const IS_LOCAL = /^(https?:\/\/)(localhost|127\.0\.0\.1)(?=[:/]|$)/;
const KEEP_LOCAL = new Set(["GOOGLE_REDIRECT_URI", "GOOGLE_LOGIN_REDIRECT_URI"]);
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
    console.log(`🔁 ${file}: ${[...olds].join(", ")} → ${ip} (${[...changed].join(", ")})`);
  }
}
NODE
}

# The .env files whose URLs point at this machine on the LAN (phones, the
# recorder box and the web app reach the API by IP, not localhost).
ENV_FILES=(back/.env front/.env app/.env edge/.env)

# ── process helpers ──────────────────────────────────────────────────────────

# Pids listening on a TCP port. One per line, deduped — a server bound to both
# IPv4 and IPv6 shows up twice under the same pid.
listeners_on() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | sort -u
}

# The executable name for a pid, without its path. Empty if the pid is gone.
comm_of() {
  ps -p "$1" -o comm= 2>/dev/null | sed 's|.*/||'
}

pgid_of() {
  ps -p "$1" -o pgid= 2>/dev/null | tr -d ' '
}

# Is this pid tree actually running node?
#
# ⚠️ "a process with this pid exists" is NOT enough. A pid file left behind by a
#    shell that died without its EXIT trap can name a completely unrelated
#    process, and we are about to signal a whole process group. Only act if the
#    tree still has a node in it, which the runner always does while servers are
#    up and an unrelated process will not.
has_node_descendant() {
  local snapshot queue pid kids k name
  snapshot="$(ps -Ao pid=,ppid=,comm= 2>/dev/null)"
  queue="$1"

  while [ -n "$queue" ]; do
    pid="${queue%% *}"
    if [ "$queue" = "$pid" ]; then queue=""; else queue="${queue#* }"; fi

    name="$(echo "$snapshot" | awk -v p="$pid" '$1 == p { print $3 }' | sed 's|.*/||')"
    case "$name" in
      node) return 0 ;;
    esac

    kids="$(echo "$snapshot" | awk -v p="$pid" '$2 == p { print $1 }')"
    for k in $kids; do queue="$queue $k"; done
  done
  return 1
}

# Kill a pid and everything under it, by process group.
#
# 🚨 The group, not the pid. `npm run dev` is a wrapper — killing it alone
#    orphans the vite or nodemon child that is actually holding the port, which
#    is the failure mode that makes a dev script look like it works when it does
#    not. `set -m` below puts each app in its own group precisely so this is safe.
#
# ⚠️ Guarded against our own group. Without that guard, a fallback to the
#    caller's pgid would take down the terminal running the script.
kill_group() {
  local pid="$1" pgid i
  pgid="$(pgid_of "$pid")"

  if [ -z "$pgid" ] || [ "$pgid" = "$MYPGID" ] || [ "$pgid" = "0" ] || [ "$pgid" = "1" ]; then
    kill -TERM "$pid" 2>/dev/null
    return 0
  fi

  kill -TERM "-$pgid" 2>/dev/null

  # Two seconds to shut down cleanly, then it goes. Vite flushes and exits well
  # inside this; nodemon occasionally does not.
  i=0
  while [ "$i" -lt 10 ]; do
    kill -0 "-$pgid" 2>/dev/null || return 0
    sleep 0.2
    i=$((i + 1))
  done
  kill -KILL "-$pgid" 2>/dev/null
}

# ── ./run-mac.sh stop ────────────────────────────────────────────────────────
# Frees the dev ports by pid, but only when the listener is actually node — a
# busy port can legitimately belong to something else, and killing that would be
# worse than the collision.
if [ "${1:-}" = "stop" ]; then
  killed=0

  # The runner first. Without this, `stop` run from a second terminal frees the
  # ports but leaves nodemon sitting on "app crashed — waiting for file
  # changes", so npm never exits and the original terminal looks hung.
  if [ -f "$PIDFILE" ]; then
    runpid="$(cat "$PIDFILE" 2>/dev/null)"
    if [ -n "$runpid" ] && [ "$runpid" != "$$" ] && has_node_descendant "$runpid"; then
      kill_group "$runpid"
      echo "stopped run-mac.sh (pid $runpid)"
      killed=$((killed + 1))
    fi
    rm -f "$PIDFILE"
  fi

  for entry in "${ALL[@]}"; do
    name="${entry%%:*}"
    rest="${entry#*:}"
    port="${rest%%:*}"

    for pid in $(listeners_on "$port"); do
      image="$(comm_of "$pid")"
      case "$image" in
        node)
          kill_group "$pid"
          echo "stopped $name (port $port, pid $pid)"
          killed=$((killed + 1))
          ;;
        "")
          # Gone between lsof and ps. Nothing to do.
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
# Say so up front, and say WHAT is holding it — often not another dev server.
for entry in "${selected[@]}"; do
  name="${entry%%:*}"
  rest="${entry#*:}"
  port="${rest%%:*}"

  for pid in $(listeners_on "$port"); do
    echo "!! port $port ($name) is already in use by $(comm_of "$pid") (pid $pid)" >&2
    echo "   run ./run-mac.sh stop, or close the other process" >&2
    fail=1
  done
done
[ "$fail" -eq 0 ] || exit 1

# ── shutdown ─────────────────────────────────────────────────────────────────
CHILDREN=""
stopping=0

stop() {
  [ "$stopping" -eq 0 ] || return
  stopping=1
  trap - INT TERM EXIT

  # ⚠️ Silence the shell's own job notices for the rest of shutdown. `set -m`
  #    makes bash announce every reaped job — "line 250: 10925 Terminated: 15",
  #    once per app — which reads like a crash at the end of a clean Ctrl+C.
  #    `set +m` alone does NOT stop it: the notice is written to the shell's
  #    stderr while the kills are still running, so the stream has to go too.
  #    Our own messages are on stdout and are unaffected.
  set +m 2>/dev/null
  exec 2>/dev/null

  printf '\n\033[1;31mStopping…\033[0m\n'

  for pid in $CHILDREN; do
    kill_group "$pid"
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
echo "$$" > "$PIDFILE"

# 🚨 Job control ON, in a non-interactive script, deliberately. It puts each
#    background job in its OWN process group, which is what makes `kill -TERM
#    -$pgid` above kill npm *and* the vite/nodemon child under it. It also means
#    Ctrl+C reaches only this script — the children are signalled by the trap,
#    once, instead of racing it.
set -m

# Prefix every line with the app name, in its colour.
prefix() {
  local colour="$1" name="$2" line
  while IFS= read -r line; do
    printf '\033[1;%sm%-6s\033[0m | %s\n' "$colour" "$name" "$line"
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
  #    unkillable. This way $! is the app itself, and `set -m` has made it a
  #    group leader.
  ( cd "$name" && exec npm run dev ) > >(prefix "$colour" "$name") 2>&1 &
  CHILDREN="$CHILDREN $!"

  printf '\033[1;%sm%-6s\033[0m http://localhost:%s\n' "$colour" "$name" "$port"
done

printf '\nCtrl+C stops everything.  If anything is left behind: ./run-mac.sh stop\n\n'
wait
