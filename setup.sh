#!/usr/bin/env bash
# First-time setup: install dependencies, create the .env files (back, front,
# edge), generate the backend secrets and the JWT key pair, wire the recorder
# box (edge/) to the local API, then ask for DB_USER / DB_PASS / DB_DATABASE
# and SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD — once all are set — run `npm run db:setup`
# (PLAN-008: it creates only the back-office super admin). Last, it pairs the
# recorder box: pick its venue (VENUE_ID) from the database and a box name.
#
# Safe to re-run: an existing .env is kept, a secret is generated only while it
# still holds the CHANGE_THIS placeholder (or is empty), and existing JWT keys
# are left alone. Each DB prompt can be skipped with Enter (keeping the current
# value); the prompts are skipped entirely when not run from a terminal.
#
# Usage: ./setup.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Backend ────────────────────────────────────────────────────────────────────
echo "📦 back: installing dependencies..."
cd "$ROOT/back"
npm i

if [ ! -f .env ]; then
  cp .env.example .env
  echo "📝 back: created .env from .env.example"
else
  echo "⏭️  back: .env already exists — keeping it"
fi

# KEY:bytes — each becomes a random hex string of 2 × bytes characters
node - CSRF_SECRET:32 LOG_SALT:32 UPLOAD_URL_SECRET:64 DEVICE_SECRET_KEY:32 <<'NODE'
const fs = require("fs");
const crypto = require("crypto");

let env = fs.readFileSync(".env", "utf8");
for (const spec of process.argv.slice(2)) {
  const [key, bytes] = spec.split(":");
  const line = new RegExp(`^${key}=(.*)$`, "m");
  const match = env.match(line);
  const value = match ? match[1].trim() : "";

  if (value && !value.startsWith("CHANGE_THIS")) {
    console.log(`⏭️  back: ${key} already set — keeping it`);
    continue;
  }

  const secret = crypto.randomBytes(Number(bytes)).toString("hex");
  env = match ? env.replace(line, `${key}=${secret}`) : `${env.trimEnd()}\n${key}=${secret}\n`;
  console.log(`🔑 back: generated ${key}`);
}
fs.writeFileSync(".env", env);
NODE

if [ -f auth-keys/private.pem ] && [ -f auth-keys/public.pem ]; then
  echo "⏭️  back: JWT keys already exist — keeping them"
else
  npm run keys
fi

# ── Frontend ───────────────────────────────────────────────────────────────────
echo "📦 front: installing dependencies..."
cd "$ROOT/front"
npm i

if [ ! -f .env ]; then
  cp .env.example .env
  echo "📝 front: created .env from .env.example"
else
  echo "⏭️  front: .env already exists — keeping it"
fi

# ── Recorder box (edge/) ───────────────────────────────────────────────────────
# For running the box on this machine against the local API (./run-mac.sh …
# edge). A real venue box is set up on its own machine — see edge/README.md.
echo "📦 edge: installing dependencies..."
cd "$ROOT/edge"
npm i

if [ ! -f .env ]; then
  cp .env.example .env
  echo "📝 edge: created .env from .env.example"
else
  echo "⏭️  edge: .env already exists — keeping it"
fi

# Points the box at the local API (only while API_URL is still the example
# value). PLAN-008: the enroll key is the company's, generated in the back office
# (/backoffice → the company → Box enroll key) — paste it into edge/.env as
# ENROLL_KEY. Keys are never printed.
ROOT="$ROOT" node <<'NODE'
const fs = require("fs");
const path = require("path");

const backFile = path.join(process.env.ROOT, "back/.env");
const edgeFile = path.join(process.env.ROOT, "edge/.env");
let back = fs.readFileSync(backFile, "utf8");
let edge = fs.readFileSync(edgeFile, "utf8");

const get = (env, key) => {
  const m = env.match(new RegExp(`^${key}=(.*)$`, "m"));
  return m ? m[1].trim().replace(/^(['"])(.*)\1$/, "$2") : "";
};
const set = (env, key, value) => {
  const line = new RegExp(`^${key}=.*$`, "m");
  return line.test(env)
    ? env.replace(line, () => `${key}=${value}`)
    : `${env.trimEnd()}\n${key}=${value}\n`;
};

const apiUrl = get(edge, "API_URL");
if (!apiUrl || apiUrl === "https://api.example.com") {
  const port = get(back, "PORT") || "4021";
  edge = set(edge, "API_URL", `http://localhost:${port}`);
  console.log(`🔗 edge: API_URL set to http://localhost:${port}`);
} else {
  console.log("⏭️  edge: API_URL already set — keeping it");
}

if (!get(edge, "ENROLL_KEY")) {
  console.log("ℹ️  edge: ENROLL_KEY is empty — generate the company's key in the back office (/backoffice → the company → Box enroll key) and paste it");
} else {
  console.log("⏭️  edge: ENROLL_KEY already set — keeping it");
}
fs.writeFileSync(edgeFile, edge);

if (!get(edge, "VENUE_ID")) {
  console.log("ℹ️  edge: VENUE_ID is empty — set it once a venue exists (Setup → Venues → Copy ID)");
}
NODE

if command -v ffmpeg >/dev/null 2>&1; then
  echo "✅ edge: ffmpeg found ($(ffmpeg -version 2>/dev/null | head -n 1 | cut -d' ' -f1-3))"
else
  echo "⚠️  edge: ffmpeg not found — install it (macOS: brew install ffmpeg) before running the box"
fi

# ── Database ───────────────────────────────────────────────────────────────────
cd "$ROOT/back"

# Prints KEY's value from back/.env, or nothing while it is unset or still the
# your_… placeholder from .env.example.
env_get() {
  KEY="$1" node -e '
    const v = require("dotenv").parse(require("fs").readFileSync(".env"))[process.env.KEY] || "";
    process.stdout.write(v.startsWith("your_") ? "" : v);
  '
}

# Writes KEY=VALUE into back/.env, quoting the value when dotenv needs it to.
env_set() {
  KEY="$1" VALUE="$2" node <<'NODE'
const fs = require("fs");
const { KEY: key, VALUE: raw } = process.env;
const value = /^[^\s#'"`\\]*$/.test(raw) ? raw
  : !raw.includes("'") ? `'${raw}'`
  : !raw.includes('"') ? `"${raw}"`
  : `\`${raw}\``;
let env = fs.readFileSync(".env", "utf8");
const line = new RegExp(`^${key}=.*$`, "m");
env = line.test(env) ? env.replace(line, () => `${key}=${value}`) : `${env.trimEnd()}\n${key}=${value}\n`;
fs.writeFileSync(".env", env);
NODE
}

# Asks for KEY (Enter keeps the current value, or skips it); returns non-zero
# when it is still unset afterwards.
ask() {
  local key=$1 label=$2 secret=${3:-} current answer hint
  current=$(env_get "$key")
  if [ -z "$current" ]; then hint="Enter to skip"
  elif [ -n "$secret" ]; then hint="Enter keeps the current one"
  else hint="Enter keeps $current"
  fi
  if [ -n "$secret" ]; then
    read -rsp "   $label ($hint): " answer; echo
  else
    read -rp "   $label ($hint): " answer
  fi
  if [ -n "$answer" ]; then
    env_set "$key" "$answer"
    current=$answer
  fi
  [ -n "$current" ]
}

db_ready=""
if [ -t 0 ]; then
  echo
  echo "🗄️  back: database connection (DB_HOST is $(env_get DB_HOST) — edit back/.env to change it)"
  missing=0
  ask DB_USER "DB_USER" || missing=1
  ask DB_PASS "DB_PASS" secret || missing=1
  ask DB_DATABASE "DB_DATABASE" || missing=1
  # PLAN-008: db:setup creates only the back-office super admin — it needs both
  echo "👤 back: the back-office super admin (your /backoffice login; 8+ character password)"
  ask SUPERADMIN_EMAIL "SUPERADMIN_EMAIL" || missing=1
  ask SUPERADMIN_PASSWORD "SUPERADMIN_PASSWORD" secret || missing=1

  if [ "$missing" -eq 0 ]; then
    echo "🗄️  back: running db:setup..."
    if npm run db:setup; then
      db_ready=1
    else
      echo "⚠️  back: db:setup failed — check the DB_* and SUPERADMIN_* values in back/.env, then re-run it"
    fi
  else
    echo "⏭️  back: DB_* / SUPERADMIN_* not all set — skipping db:setup"
  fi
fi

# ── Recorder box pairing (edge/ ↔ back/) ───────────────────────────────────────
# What the box needs to enrol with the local API on its first start (POST
# /api/v1/pair/enroll): ENROLL_KEY = the venue's company's key from the back office,
# API_URL (wired above), VENUE_ID — picked here from the venues in the
# database — and an optional BOX_NAME. Once enrolled, the box keeps its own
# token in edge/data/device.json and no longer uses these.

# Prints KEY's value from edge/.env (plain KEY=value lines, no dotenv in edge/).
edge_get() {
  sed -n "s/^$1=//p" "$ROOT/edge/.env" | tail -n 1 | tr -d '\r' | sed "s/^['\"]\(.*\)['\"]\$/\1/"
}

# Venues the box can enrol into, as "venueId<TAB>name" lines (reads back/.env).
list_venues() {
  cd "$ROOT/back" && node <<'NODE'
require("dotenv").config({ quiet: true });
const mysql = require("mysql2/promise");
(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_DATABASE,
    port: parseInt(process.env.DB_PORT || "3306", 10),
  });
  const [rows] = await conn.query(
    "SELECT venueId, name FROM venues WHERE status != 'Deleted' ORDER BY name"
  );
  await conn.end();
  for (const r of rows) console.log(`${r.venueId}\t${String(r.name).replace(/\s+/g, " ")}`);
})().catch((err) => {
  console.error(`   (${err.code || err.message})`);
  process.exit(1);
});
NODE
}

box_paired=""
if [ -t 0 ]; then
  echo
  echo "📡 edge: pairing the recorder box with the API"
  edge_data="$(edge_get DATA_DIR)"
  edge_data="${edge_data:-./data}"
  case "$edge_data" in /*) ;; *) edge_data="$ROOT/edge/${edge_data#./}" ;; esac

  if [ -f "$edge_data/device.json" ]; then
    echo "⏭️  edge: already enrolled ($edge_data/device.json) — delete that file to enrol again"
    box_paired=1
  elif [ -z "$(env_get DB_USER)" ] || [ -z "$(env_get DB_DATABASE)" ]; then
    echo "⏭️  edge: no database settings yet — re-run ./setup.sh after db:setup to pick the venue"
  else
    if venues="$(list_venues)"; then
      current="$(edge_get VENUE_ID)"
      if [ -z "$venues" ]; then
        echo "ℹ️  edge: no venues yet — add one in Admin → Setup → Venues, then re-run ./setup.sh"
      else
        echo "   Venues:"
        i=0
        default=""
        while IFS=$'\t' read -r id name; do
          i=$((i + 1))
          mark=""
          if [ "$id" = "$current" ]; then mark="  ← current"; default=$i; fi
          echo "     $i) $name$mark"
        done <<< "$venues"
        [ -n "$default" ] || { [ "$i" -eq 1 ] && default=1; }
        if [ -n "$default" ]; then hint="Enter = $default"; else hint="Enter to skip"; fi
        read -rp "   Which venue is this box at? ($hint): " pick
        pick="${pick:-$default}"
        if [ -n "$pick" ]; then
          chosen="$(sed -n "${pick}p" <<< "$venues" 2>/dev/null | cut -f1)"
          if [ -n "$chosen" ] && [[ "$pick" =~ ^[0-9]+$ ]]; then
            (cd "$ROOT/edge" && env_set VENUE_ID "$chosen")
            echo "📝 edge: VENUE_ID set to $(sed -n "${pick}p" <<< "$venues" | cut -f2)"
          else
            echo "⚠️  edge: no venue $pick — VENUE_ID left as it was"
          fi
        fi

        keep_name="$(edge_get BOX_NAME)"
        [ -n "$keep_name" ] || keep_name="the computer's name"
        read -rp "   Box name, as Admin lists it (Enter keeps $keep_name): " box_name
        if [ -n "$box_name" ]; then
          (cd "$ROOT/edge" && env_set BOX_NAME "$box_name")
          echo "📝 edge: BOX_NAME set"
        fi
      fi
    else
      echo "⚠️  edge: couldn't read the venues from the database — check DB_* in back/.env, then re-run"
    fi
  fi

  if [ -z "$box_paired" ]; then
    # PLAN-008: the key is the venue's company's (back office); the API checks it matches
    box_key="$(edge_get ENROLL_KEY)"
    if [ "${#box_key}" -lt 32 ]; then
      echo "⚠️  edge: ENROLL_KEY is missing — generate the company's key in the back office and paste it"
    elif [ -n "$(edge_get VENUE_ID)" ]; then
      echo "✅ edge: ready to enrol — it pairs itself on its first start against $(edge_get API_URL)"
      box_paired=1
    fi
  fi
fi

echo
echo "✅ Setup complete. Next:"
if [ -n "$db_ready" ]; then
  echo "   1. ./run-mac.sh (macOS) or ./run.sh (Windows), sign in to /backoffice (SUPERADMIN_EMAIL / _PASSWORD) and onboard a company"
else
  echo "   1. Set DB_HOST / DB_USER / DB_PASS / DB_DATABASE in back/.env"
  echo "   2. Set SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD, then cd back && npm run db:setup   (creates the back-office super admin)"
  echo "   3. ./run-mac.sh (macOS) or ./run.sh (Windows)"
fi
if [ -n "$box_paired" ]; then
  echo "   Recorder box: give the venue's courts their cameras in Admin, then add edge:"
  echo "   ./run-mac.sh back front edge"
else
  echo "   Recorder box: add a venue and its courts (cameras) in Admin, generate the company's enroll key"
  echo "   in the back office (ENROLL_KEY in edge/.env), re-run ./setup.sh to pick the venue (or set"
  echo "   VENUE_ID), then add edge: ./run-mac.sh back front edge"
fi
