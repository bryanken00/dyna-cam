#!/bin/bash

set -e

MIGRATE=false
NPMINSTALL=false
ENV_NAME=""
DEPLOY_BRANCH="main"

# Parse all arguments
for arg in "$@"; do
    case "$arg" in
        --dev)
            ENV_NAME="dev"
            ;;
        --prod)
            ENV_NAME="prod"
            ;;
        --migrate)
            MIGRATE=true
            ;;
        --install)
            NPMINSTALL=true
            ;;
        *)
            ;;
    esac
done

# Validate environment
if [ -z "$ENV_NAME" ]; then
    echo "Usage: $0 [--dev|--prod] [--install] [--migrate]"
    exit 1
fi

cd "$(dirname "${BASH_SOURCE[0]}")"

# Deploy targets live in .env (REMOTE_DIR_DEV, REMOTE_DIR_PROD, ...), not in this file
env_get() {
    grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}
SUFFIX="$(echo "$ENV_NAME" | tr '[:lower:]' '[:upper:]')"
DEPLOY_HOST="$(env_get DEPLOY_HOST)"
DEPLOY_HOST="${DEPLOY_HOST:-office}"
REMOTE_DIR="$(env_get "REMOTE_DIR_$SUFFIX")"
PORT="$(env_get "PM2_PORT_$SUFFIX")"
if [ -z "$REMOTE_DIR" ] || [ -z "$PORT" ]; then
    echo "❌ No server set for --$ENV_NAME. Set REMOTE_DIR_$SUFFIX and PM2_PORT_$SUFFIX in back/.env."
    exit 1
fi

# Pre-flight (PLAN-010): only committed, reviewed, tested code goes out
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" != "$DEPLOY_BRANCH" ]; then
    echo "❌ On branch '$BRANCH'. Deploy only from '$DEPLOY_BRANCH'."
    exit 1
fi
if [ -n "$(git status --porcelain -- . ':!deploy-logs')" ]; then
    echo "❌ Uncommitted changes. Commit or stash them first:"
    git status --short -- . ':!deploy-logs'
    exit 1
fi
COMMIT="$(git rev-parse HEAD)"

# Commits since the last deploy to this environment (only ones touching back/)
LAST="$(ssh "$DEPLOY_HOST" "cat $REMOTE_DIR/DEPLOYED 2>/dev/null" | awk '{print $1}')"
if [ -n "$LAST" ] && git cat-file -e "$LAST^{commit}" 2>/dev/null; then
    CHANGES="$(git log --format='  %h %ad %s' --date=short "$LAST..$COMMIT" -- .)"
    [ -n "$CHANGES" ] || CHANGES="  (no changes since last deploy)"
elif [ -n "$LAST" ]; then
    CHANGES="  (last deployed commit $LAST not found locally)"
else
    CHANGES="  (first recorded deploy)"
fi
echo "📝 Changes since last $ENV_NAME deploy (${LAST:0:7}):"
echo "$CHANGES"

echo "🔍 Lint and tests..."
npm run lint
npm test

echo "🚀 Deploying $COMMIT to: $REMOTE_DIR"

# Safety check + cleanup
ssh "$DEPLOY_HOST" "
    set -e

    cd $REMOTE_DIR || {
        echo 'ERROR: Deployment directory not found!'
        exit 1
    }

    if [ ! -f package.json ]; then
        echo 'ERROR: package.json not found. Aborting.'
        exit 1
    fi

"

echo "📤 Uploading files..."

scp -r database "$DEPLOY_HOST":"$REMOTE_DIR/"
scp -r scripts "$DEPLOY_HOST":"$REMOTE_DIR/"
scp -r server "$DEPLOY_HOST":"$REMOTE_DIR/"
scp -r package.json "$DEPLOY_HOST":"$REMOTE_DIR/"

if $NPMINSTALL; then
    echo "📦 Installing npm dependencies (exact versions from package-lock.json)..."
    ssh "$DEPLOY_HOST" "cd $REMOTE_DIR && sudo npm ci --omit=dev"
fi

if $MIGRATE; then
    echo "🗄️ Running database migrations..."
    ssh "$DEPLOY_HOST" "cd $REMOTE_DIR && sudo npm run db:migrate"
fi

echo "♻️ Reloading PM2..."
ssh "$DEPLOY_HOST" "sudo pm2 reload /$PORT/"

# Record what is running, for the audit trail of changes
ssh "$DEPLOY_HOST" "cd $REMOTE_DIR && printf '%s %s %s\n' '$COMMIT' \"\$(date -u +%Y-%m-%dT%H:%M:%SZ)\" '$(git config user.email)' > DEPLOYED && cat DEPLOYED >> deploy-history.log"

# Local deploy log: one file per successful deploy, e.g. "dev-10-30-2026-1032PM.log"
mkdir -p deploy-logs
LOG_FILE="deploy-logs/$ENV_NAME-$(date '+%m-%d-%Y-%I%M%p').log"
n=2
while [ -e "$LOG_FILE" ]; do
    LOG_FILE="deploy-logs/$ENV_NAME-$(date '+%m-%d-%Y-%I%M%p')-$n.log"
    n=$((n + 1))
done
{
    echo "Environment: $ENV_NAME"
    echo "Date:        $(date '+%Y-%m-%d %H:%M:%S %z')"
    echo "Commit:      $COMMIT"
    echo "Previous:    ${LAST:-none}"
    echo "By:          $(git config user.email)"
    echo "Install:     $NPMINSTALL | Migrate: $MIGRATE"
    echo
    echo "Commits since last deploy:"
    echo "$CHANGES"
} > "$LOG_FILE"

echo "✅ Deployment complete! ($COMMIT) — logged to $LOG_FILE"
