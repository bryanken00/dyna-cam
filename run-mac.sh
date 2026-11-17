#!/usr/bin/env bash
#
# run-mac.sh — run the API and the frontend from one terminal, on macOS.
#
#   ./run-mac.sh                 # both
#   ./run-mac.sh back            # just the API (or: front)
#   ./run-mac.sh stop            # free the dev ports if anything was left behind
#
# Output is prefixed per app. Ctrl+C stops all of them.
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

# name : port : ANSI colour
ALL=(
  "back:$BACK_PORT:36"
  "front:4020:34"
)

PIDFILE=".run.pid"

# Our own process group, so nothing below can ever signal the terminal we are
# running in. Every kill path checks against this.
MYPGID="$(ps -p $$ -o pgid= 2>/dev/null | tr -d ' ')"

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
  selected=("${ALL[@]}")
else
  for want in "$@"; do
    hit=""
    for entry in "${ALL[@]}"; do
      [ "${entry%%:*}" = "$want" ] && hit="$entry"
    done
    if [ -z "$hit" ]; then
      echo "Unknown app: $want" >&2
      echo "Choose from: back front  (or: stop)" >&2
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
