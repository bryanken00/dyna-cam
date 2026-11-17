#!/usr/bin/env bash
# First-time setup: install dependencies, create both .env files, generate the
# backend secrets and the JWT key pair, then ask for DB_USER / DB_PASS /
# DB_DATABASE and — once all three are set — run `npm run db:setup`.
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

  if [ "$missing" -eq 0 ]; then
    echo "🗄️  back: running db:setup..."
    if npm run db:setup; then
      db_ready=1
    else
      echo "⚠️  back: db:setup failed — check the DB_* values in back/.env, then re-run it"
    fi
  else
    echo "⏭️  back: DB_* not all set — skipping db:setup"
  fi
fi

echo
echo "✅ Setup complete. Next:"
if [ -n "$db_ready" ]; then
  echo "   1. npm run dev in back/ and front/   (sign in with the Owner password printed above)"
else
  echo "   1. Set DB_HOST / DB_USER / DB_PASS / DB_DATABASE in back/.env"
  echo "   2. cd back && npm run db:setup   (prints the Owner's one-time password)"
  echo "   3. npm run dev in back/ and front/"
fi
